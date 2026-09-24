import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import type { Database } from "bun:sqlite";
import { openDb } from "./db.ts";
import { gitBranch, listWorktreeFiles } from "./git.ts";
import {
  dbPath,
  lockPath,
  pidPath,
  sockPath,
  wcpDir,
} from "./paths.ts";
import { absFromBoard, isoNow, pidAlive, sha256File } from "./protocol.ts";
import { writeView } from "./render.ts";
import { handle, type RpcCtx, type RpcRequest } from "./rpc.ts";

export type Daemon = {
  stop: () => void;
  repoRoot: string;
};

type SockData = { buf: string };

function takeLock(root: string): number {
  mkdirSync(wcpDir(root), { recursive: true });
  const lock = lockPath(root);
  const pid = pidPath(root);
  try {
    const fd = openSync(lock, "wx");
    writeFileSync(pid, `${process.pid}\n`);
    return fd;
  } catch {
    let stalePid = 0;
    try {
      stalePid = parseInt(readFileSync(pid, "utf8"), 10);
    } catch {
      stalePid = 0;
    }
    if (stalePid && pidAlive(stalePid)) {
      throw new Error(`wcpd already running (pid ${stalePid})`);
    }
    try {
      unlinkSync(lock);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(pid);
    } catch {
      /* ignore */
    }
    const fd = openSync(lock, "wx");
    writeFileSync(pid, `${process.pid}\n`);
    return fd;
  }
}

function makeCtx(db: Database, repoRoot: string, now?: () => string): RpcCtx {
  return {
    db,
    repoRoot,
    now: now ?? (() => isoNow()),
    gitBranch: () => gitBranch(repoRoot),
    pidAlive,
    sha256: (boardPath) => sha256File(absFromBoard(repoRoot, boardPath)),
    listExisted: () => listWorktreeFiles(repoRoot),
  };
}

function refreshView(ctx: RpcCtx): void {
  const look = handle(ctx, { id: "view", method: "look" });
  if (look.ok) {
    writeView(ctx.repoRoot, look);
  }
}

export function startDaemon(opts: {
  repoRoot: string;
  now?: () => string;
}): Daemon {
  const { repoRoot } = opts;
  mkdirSync(wcpDir(repoRoot), { recursive: true });
  const lockFd = takeLock(repoRoot);
  const sock = sockPath(repoRoot);
  if (existsSync(sock)) {
    try {
      unlinkSync(sock);
    } catch {
      /* ignore */
    }
  }
  const db = openDb(dbPath(repoRoot));
  const ctx = makeCtx(db, repoRoot, opts.now);
  refreshView(ctx);

  let stopped = false;
  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    try {
      server.stop(true);
    } catch {
      /* ignore */
    }
    try {
      db.close();
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(sock);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(pidPath(repoRoot));
    } catch {
      /* ignore */
    }
    try {
      closeSync(lockFd);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(lockPath(repoRoot));
    } catch {
      /* ignore */
    }
  };

  const server = Bun.listen<SockData>({
    unix: sock,
    socket: {
      open(socket) {
        socket.data = { buf: "" };
      },
      data(socket, data) {
        const text = typeof data === "string" ? data : new TextDecoder().decode(data);
        socket.data.buf += text;
        let nl = socket.data.buf.indexOf("\n");
        while (nl >= 0) {
          const line = socket.data.buf.slice(0, nl).trim();
          socket.data.buf = socket.data.buf.slice(nl + 1);
          if (line) {
            let req: RpcRequest;
            try {
              req = JSON.parse(line) as RpcRequest;
            } catch {
              socket.write(
                `${JSON.stringify({ id: "?", ok: false, error: "invalid", message: "bad json" })}\n`,
              );
              nl = socket.data.buf.indexOf("\n");
              continue;
            }
            const res = handle(ctx, req);
            if (req.method !== "look") {
              refreshView(ctx);
            } else if (res.ok) {
              writeView(ctx.repoRoot, res);
            }
            socket.write(`${JSON.stringify(res)}\n`);
            if (req.method === "stop") {
              setTimeout(stop, 10);
            }
          }
          nl = socket.data.buf.indexOf("\n");
        }
      },
      error(_socket, error) {
        console.error("wcpd socket error", error);
      },
    },
  });

  return { stop, repoRoot };
}
