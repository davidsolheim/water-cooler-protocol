import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.ts";
import { absFromBoard, sha256File } from "../src/protocol.ts";
import { handle, type RpcCtx, type RpcRequest } from "../src/rpc.ts";

const temps: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "wcp-rpc-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fixture() {
  const repoRoot = tempDir();
  mkdirSync(join(repoRoot, "src"), { recursive: true });
  writeFileSync(join(repoRoot, "src", "a.ts"), "one");
  writeFileSync(join(repoRoot, "src", "b.ts"), "two");
  const db = openDb(join(repoRoot, "run.sqlite"));
  let now = "2026-09-18T19:51:00Z";
  let branch = "dev";
  const livePids = new Set<number>([1001, 1002, 1003]);
  const ctx: RpcCtx = {
    db,
    repoRoot,
    now: () => now,
    gitBranch: () => branch,
    pidAlive: (pid) => livePids.has(pid),
    sha256: (boardPath) => sha256File(absFromBoard(repoRoot, boardPath)),
  };
  let n = 0;
  function call(method: RpcRequest["method"], params?: Record<string, unknown>) {
    n += 1;
    return handle(ctx, { id: String(n), method, params });
  }
  return {
    repoRoot,
    ctx,
    call,
    setNow: (iso: string) => {
      now = iso;
    },
    setBranch: (b: string) => {
      branch = b;
    },
    killPid: (pid: number) => {
      livePids.delete(pid);
    },
    write: (rel: string, body: string) => {
      writeFileSync(join(repoRoot, ...rel.split("/")), body);
    },
  };
}

describe("start and look", () => {
  test("look without a run is no_run", () => {
    const { call } = fixture();
    const res = call("look");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("no_run");
  });

  test("start then look returns arch and empty live", () => {
    const { call } = fixture();
    const started = call("start", { arch: "rotate refresh tokens", branch: "dev" });
    expect(started.ok).toBe(true);
    const look = call("look");
    expect(look.ok).toBe(true);
    if (look.ok) {
      expect(look.arch).toBe("rotate refresh tokens");
      expect(look.branch).toBe("dev");
      expect(look.ttl_sec).toBe(60);
      expect(look.live).toEqual([]);
    }
  });
});

describe("set_arch", () => {
  test("rejects missing human flag", () => {
    const { call } = fixture();
    call("start", { arch: "a" });
    const res = call("set_arch", { arch: "b" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("forbidden");
  });

  test("human can set arch", () => {
    const { call } = fixture();
    call("start", { arch: "a" });
    const res = call("set_arch", { arch: "b", human: true });
    expect(res.ok).toBe(true);
    const look = call("look");
    if (look.ok) expect(look.arch).toBe("b");
  });
});

describe("acquire", () => {
  test("second agent on the same path gets conflict", () => {
    const { call } = fixture();
    call("start", { arch: "demo" });
    const a = call("acquire", {
      agent: "auth-1",
      path: "src/a.ts",
      doing: "rotate cookie",
      scope: "rotateRefreshToken",
      pid: 1001,
    });
    expect(a.ok).toBe(true);
    const b = call("acquire", {
      agent: "ui-2",
      path: "src/a.ts",
      doing: "empty state",
      pid: 1002,
    });
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(b.error).toBe("conflict");
      expect(b.existing?.agent_id).toBe("auth-1");
      expect(b.existing?.doing).toBe("rotate cookie");
    }
  });

  test("same agent cannot hold two paths", () => {
    const { call } = fixture();
    call("start", { arch: "demo" });
    call("acquire", { agent: "auth-1", path: "src/a.ts", doing: "a", pid: 1001 });
    const b = call("acquire", { agent: "auth-1", path: "src/b.ts", doing: "b", pid: 1001 });
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(b.error).toBe("agent_busy");
      expect(b.existing?.path).toBe("src/a.ts");
    }
  });

  test("release frees both agent and path", () => {
    const { call } = fixture();
    call("start", { arch: "demo" });
    call("acquire", { agent: "auth-1", path: "src/a.ts", doing: "a", pid: 1001 });
    const rel = call("release", { agent: "auth-1" });
    expect(rel.ok).toBe(true);
    const b = call("acquire", { agent: "ui-2", path: "src/a.ts", doing: "b", pid: 1002 });
    expect(b.ok).toBe(true);
    const a2 = call("acquire", { agent: "auth-1", path: "src/b.ts", doing: "c", pid: 1001 });
    expect(a2.ok).toBe(true);
  });
});

describe("ttl and overtake", () => {
  test("overtake on a live lease is not_idle", () => {
    const { call } = fixture();
    call("start", { arch: "demo" });
    call("acquire", { agent: "auth-1", path: "src/a.ts", doing: "rotate cookie", pid: 1001 });
    const o = call("overtake", { agent: "ui-2", path: "src/a.ts" });
    expect(o.ok).toBe(false);
    if (!o.ok) expect(o.error).toBe("not_idle");
  });

  test("overtake on expired lease inherits doing and sets from_agent", () => {
    const { call, setNow } = fixture();
    call("start", { arch: "demo" });
    call("acquire", {
      agent: "auth-1",
      path: "src/a.ts",
      doing: "rotate cookie",
      scope: "rotateRefreshToken",
      pid: 1001,
    });
    setNow("2026-09-18T19:52:00Z");
    const look = call("look");
    expect(look.ok).toBe(true);
    if (look.ok) {
      expect(look.live).toHaveLength(1);
      expect(look.live[0]?.expired).toBe(true);
      expect(look.live[0]?.doing).toBe("rotate cookie");
    }
    const o = call("overtake", { agent: "ui-2", path: "src/a.ts" });
    expect(o.ok).toBe(true);
    if (o.ok) {
      expect(o.row?.agent_id).toBe("ui-2");
      expect(o.row?.doing).toBe("rotate cookie");
      expect(o.row?.scope).toBe("rotateRefreshToken");
      expect(o.row?.from_agent).toBe("auth-1");
    }
    const again = call("acquire", { agent: "auth-1", path: "src/b.ts", doing: "other", pid: 1001 });
    expect(again.ok).toBe(true);
  });

  test("dead pid is idle and can be overtaken", () => {
    const { call, killPid } = fixture();
    call("start", { arch: "demo" });
    call("acquire", { agent: "auth-1", path: "src/a.ts", doing: "rotate cookie", pid: 1001 });
    killPid(1001);
    const o = call("overtake", { agent: "ui-2", path: "src/a.ts" });
    expect(o.ok).toBe(true);
    if (o.ok) expect(o.row?.from_agent).toBe("auth-1");
  });

  test("reap drops expired rows so the agent id can acquire again", () => {
    const { call, setNow } = fixture();
    call("start", { arch: "demo" });
    call("acquire", { agent: "auth-1", path: "src/a.ts", doing: "a", pid: 1001 });
    setNow("2026-09-18T19:52:00Z");
    const reaped = call("reap");
    expect(reaped.ok).toBe(true);
    if (reaped.ok) expect(reaped.released).toBe(1);
    const a = call("acquire", { agent: "auth-1", path: "src/b.ts", doing: "b", pid: 1001 });
    expect(a.ok).toBe(true);
  });

  test("acquire on an expired foreign path is still conflict so overtake can inherit", () => {
    const { call, setNow } = fixture();
    call("start", { arch: "demo" });
    call("acquire", { agent: "auth-1", path: "src/a.ts", doing: "rotate cookie", pid: 1001 });
    setNow("2026-09-18T19:52:00Z");
    const b = call("acquire", { agent: "ui-2", path: "src/a.ts", doing: "something else", pid: 1002 });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error).toBe("conflict");
  });
});

describe("drift and write_ok", () => {
  test("mid-lease file change sets drift and write_ok fails", () => {
    const { call, write } = fixture();
    call("start", { arch: "demo" });
    call("acquire", { agent: "auth-1", path: "src/a.ts", doing: "a", pid: 1001 });
    write("src/a.ts", "changed-by-sibling");
    const look = call("look");
    expect(look.ok).toBe(true);
    if (look.ok) expect(look.live[0]?.drift).toBe(true);
    const ok = call("write_ok", { agent: "auth-1", path: "src/a.ts" });
    expect(ok.ok).toBe(false);
    if (!ok.ok) expect(ok.error).toBe("drift");
  });

  test("write_ok succeeds when lease matches disk and branch", () => {
    const { call } = fixture();
    call("start", { arch: "demo", branch: "dev" });
    call("acquire", { agent: "auth-1", path: "src/a.ts", doing: "a", pid: 1001 });
    const ok = call("write_ok", { agent: "auth-1", path: "src/a.ts" });
    expect(ok.ok).toBe(true);
  });

  test("write_ok fails on wrong branch", () => {
    const { call, setBranch } = fixture();
    call("start", { arch: "demo", branch: "dev" });
    call("acquire", { agent: "auth-1", path: "src/a.ts", doing: "a", pid: 1001 });
    setBranch("main");
    const ok = call("write_ok", { agent: "auth-1", path: "src/a.ts" });
    expect(ok.ok).toBe(false);
    if (!ok.ok) expect(ok.error).toBe("wrong_branch");
  });

  test("write_ok fails after expiry", () => {
    const { call, setNow } = fixture();
    call("start", { arch: "demo" });
    call("acquire", { agent: "auth-1", path: "src/a.ts", doing: "a", pid: 1001 });
    setNow("2026-09-18T19:52:00Z");
    const ok = call("write_ok", { agent: "auth-1", path: "src/a.ts" });
    expect(ok.ok).toBe(false);
    if (!ok.ok) expect(ok.error).toBe("expired");
  });
});

describe("reup", () => {
  test("extends expires_at", () => {
    const { call } = fixture();
    call("start", { arch: "demo" });
    call("acquire", { agent: "auth-1", path: "src/a.ts", doing: "a", pid: 1001 });
    const r = call("reup", { agent: "auth-1" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.row?.expires_at).toBe("2026-09-18T19:52:00Z");
  });
});
