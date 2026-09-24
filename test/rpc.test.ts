import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { openDb } from "../src/db.ts";
import { absFromBoard, sha256File } from "../src/protocol.ts";
import { handle, type RpcCtx, type RpcRequest, type RpcResponse } from "../src/rpc.ts";

function listTree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === ".git" || ent.name === ".WCP") {
        continue;
      }
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(abs);
      } else if (ent.isFile()) {
        out.push(relative(root, abs).split(sep).join("/"));
      }
    }
  };
  walk(root);
  return out;
}

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
    listExisted: () => listTree(repoRoot),
  };
  let n = 0;
  function call(method: RpcRequest["method"], params?: Record<string, unknown>) {
    n += 1;
    return handle(ctx, { id: String(n), method, params });
  }
  function prove(agent: string, source: string): string {
    const testRel = `${source.replace(/\.[^./]+$/, "")}.test.ts`;
    const abs = join(repoRoot, ...testRel.split("/"));
    mkdirSync(join(abs, ".."), { recursive: true });
    const line = `// WCP ${agent}: ${source} proves the change (arch)\n`;
    const prev = existsSync(abs) ? readFileSync(abs, "utf8") : "";
    if (!prev.includes(line.trim())) {
      writeFileSync(abs, prev + line);
    }
    return testRel;
  }
  function lease(
    agent: string,
    path: string,
    doing: string,
    extra: Record<string, unknown> = {},
  ): RpcResponse {
    const test = prove(agent, path);
    return call("acquire", {
      agent,
      path,
      doing,
      test,
      pid: 1001,
      ...extra,
    });
  }
  return {
    repoRoot,
    ctx,
    call,
    prove,
    lease,
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
    const { call, lease, prove } = fixture();
    call("start", { arch: "demo" });
    const a = lease("auth-1", "src/a.ts", "rotate cookie", { scope: "rotateRefreshToken" });
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.row?.test_path).toBe("src/a.test.ts");
    const b = call("acquire", {
      agent: "ui-2",
      path: "src/a.ts",
      doing: "empty state",
      test: prove("ui-2", "src/a.ts"),
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
    const { call, lease } = fixture();
    call("start", { arch: "demo" });
    lease("auth-1", "src/a.ts", "a");
    const b = lease("auth-1", "src/b.ts", "b");
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(b.error).toBe("agent_busy");
      expect(b.existing?.path).toBe("src/a.ts");
    }
  });

  test("release frees both agent and path", () => {
    const { call, lease } = fixture();
    call("start", { arch: "demo" });
    lease("auth-1", "src/a.ts", "a");
    const rel = call("release", { agent: "auth-1" });
    expect(rel.ok).toBe(true);
    const b = lease("ui-2", "src/a.ts", "b", { pid: 1002 });
    expect(b.ok).toBe(true);
    const a2 = lease("auth-1", "src/b.ts", "c");
    expect(a2.ok).toBe(true);
  });

  test("refuses a claim with no test, a stale test, or the wrong path", () => {
    const { call, prove, repoRoot } = fixture();
    call("start", { arch: "demo" });
    const missing = call("acquire", {
      agent: "auth-1",
      path: "src/a.ts",
      doing: "a",
      pid: 1001,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toBe("no_test");

    const testPath = prove("auth-1", "src/b.ts");
    const wrong = call("acquire", {
      agent: "auth-1",
      path: "src/a.ts",
      doing: "a",
      test: testPath,
      pid: 1001,
    });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toBe("no_test");

    const stale = prove("auth-1", "src/a.ts");
    utimesSync(join(repoRoot, stale), new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));
    const old = call("acquire", {
      agent: "auth-1",
      path: "src/a.ts",
      doing: "a",
      test: stale,
      pid: 1001,
    });
    expect(old.ok).toBe(false);
    if (!old.ok) expect(old.error).toBe("no_test");
  });
});

describe("ttl and overtake", () => {
  test("overtake on a live lease is not_idle", () => {
    const { call, lease } = fixture();
    call("start", { arch: "demo" });
    lease("auth-1", "src/a.ts", "rotate cookie");
    const o = call("overtake", { agent: "ui-2", path: "src/a.ts" });
    expect(o.ok).toBe(false);
    if (!o.ok) expect(o.error).toBe("not_idle");
  });

  test("overtake on expired lease inherits doing and sets from_agent", () => {
    const { call, lease, prove, setNow } = fixture();
    call("start", { arch: "demo" });
    lease("auth-1", "src/a.ts", "rotate cookie", { scope: "rotateRefreshToken" });
    setNow("2026-09-18T19:52:00Z");
    const look = call("look");
    expect(look.ok).toBe(true);
    if (look.ok) {
      expect(look.live).toHaveLength(1);
      expect(look.live[0]?.expired).toBe(true);
      expect(look.live[0]?.doing).toBe("rotate cookie");
    }
    const o = call("overtake", {
      agent: "ui-2",
      path: "src/a.ts",
      test: prove("ui-2", "src/a.ts"),
    });
    expect(o.ok).toBe(true);
    if (o.ok) {
      expect(o.row?.agent_id).toBe("ui-2");
      expect(o.row?.doing).toBe("rotate cookie");
      expect(o.row?.scope).toBe("rotateRefreshToken");
      expect(o.row?.from_agent).toBe("auth-1");
      expect(o.row?.test_path).toBe("src/a.test.ts");
    }
    const again = lease("auth-1", "src/b.ts", "other");
    expect(again.ok).toBe(true);
  });

  test("dead pid is idle and can be overtaken", () => {
    const { call, lease, prove, killPid } = fixture();
    call("start", { arch: "demo" });
    lease("auth-1", "src/a.ts", "rotate cookie");
    killPid(1001);
    const o = call("overtake", {
      agent: "ui-2",
      path: "src/a.ts",
      test: prove("ui-2", "src/a.ts"),
    });
    expect(o.ok).toBe(true);
    if (o.ok) expect(o.row?.from_agent).toBe("auth-1");
  });

  test("reap drops expired rows so the agent id can acquire again", () => {
    const { call, lease, setNow } = fixture();
    call("start", { arch: "demo" });
    lease("auth-1", "src/a.ts", "a");
    setNow("2026-09-18T19:52:00Z");
    const reaped = call("reap");
    expect(reaped.ok).toBe(true);
    if (reaped.ok) expect(reaped.released).toBe(1);
    const a = lease("auth-1", "src/b.ts", "b");
    expect(a.ok).toBe(true);
  });

  test("acquire on an expired foreign path is still conflict so overtake can inherit", () => {
    const { call, lease, prove, setNow } = fixture();
    call("start", { arch: "demo" });
    lease("auth-1", "src/a.ts", "rotate cookie");
    setNow("2026-09-18T19:52:00Z");
    const b = call("acquire", {
      agent: "ui-2",
      path: "src/a.ts",
      doing: "something else",
      test: prove("ui-2", "src/a.ts"),
      pid: 1002,
    });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error).toBe("conflict");
  });
});

describe("drift and write_ok", () => {
  test("mid-lease file change sets drift and write_ok fails", () => {
    const { call, lease, write } = fixture();
    call("start", { arch: "demo" });
    lease("auth-1", "src/a.ts", "a");
    write("src/a.ts", "changed-by-sibling");
    const look = call("look");
    expect(look.ok).toBe(true);
    if (look.ok) expect(look.live[0]?.drift).toBe(true);
    const ok = call("write_ok", { agent: "auth-1", path: "src/a.ts" });
    expect(ok.ok).toBe(false);
    if (!ok.ok) expect(ok.error).toBe("drift");
  });

  test("write_ok succeeds when lease matches disk and branch", () => {
    const { call, lease } = fixture();
    call("start", { arch: "demo", branch: "dev" });
    lease("auth-1", "src/a.ts", "a");
    const ok = call("write_ok", { agent: "auth-1", path: "src/a.ts" });
    expect(ok.ok).toBe(true);
  });

  test("write_ok fails on wrong branch", () => {
    const { call, lease, setBranch } = fixture();
    call("start", { arch: "demo", branch: "dev" });
    lease("auth-1", "src/a.ts", "a");
    setBranch("main");
    const ok = call("write_ok", { agent: "auth-1", path: "src/a.ts" });
    expect(ok.ok).toBe(false);
    if (!ok.ok) expect(ok.error).toBe("wrong_branch");
  });

  test("write_ok fails after expiry", () => {
    const { call, lease, setNow } = fixture();
    call("start", { arch: "demo" });
    lease("auth-1", "src/a.ts", "a");
    setNow("2026-09-18T19:52:00Z");
    const ok = call("write_ok", { agent: "auth-1", path: "src/a.ts" });
    expect(ok.ok).toBe(false);
    if (!ok.ok) expect(ok.error).toBe("expired");
  });

  test("a pre-existing file without a lease is no_lease", () => {
    const { call } = fixture();
    call("start", { arch: "demo" });
    const ok = call("write_ok", { agent: "auth-1", path: "src/a.ts" });
    expect(ok.ok).toBe(false);
    if (!ok.ok) expect(ok.error).toBe("no_lease");
  });
});

describe("tests and new files", () => {
  test("test files and files created after start are written with no claim", () => {
    const { call, write } = fixture();
    write("src/old.test.ts", "// already here\n");
    call("start", { arch: "demo" });
    const testOk = call("write_ok", { agent: "auth-1", path: "src/old.test.ts" });
    expect(testOk.ok).toBe(true);
    if (testOk.ok) expect(testOk.claim).toBe("test");
    const claimTest = call("acquire", {
      agent: "auth-1",
      path: "src/old.test.ts",
      doing: "add a case",
      pid: 1001,
    });
    expect(claimTest.ok).toBe(false);
    if (!claimTest.ok) expect(claimTest.error).toBe("test_file");

    const created = call("write_ok", { agent: "auth-1", path: "src/fresh.ts" });
    expect(created.ok).toBe(true);
    if (created.ok) expect(created.claim).toBe("new_file");
    write("src/fresh.ts", "export const n = 1\n");
    const again = call("write_ok", { agent: "ui-2", path: "src/fresh.ts" });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.claim).toBe("new_file");
    const claimNew = call("acquire", {
      agent: "ui-2",
      path: "src/fresh.ts",
      doing: "edit fresh",
      pid: 1002,
    });
    expect(claimNew.ok).toBe(false);
    if (!claimNew.ok) expect(claimNew.error).toBe("new_file");
  });

  test("a second start does not start claiming files born during the run", () => {
    const { call, write } = fixture();
    call("start", { arch: "demo" });
    write("src/fresh.ts", "export {}\n");
    call("start", { arch: "still demo" });
    const ok = call("write_ok", { agent: "auth-1", path: "src/fresh.ts" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.claim).toBe("new_file");
  });

  test("force recaptures the tree, so a file created mid-run becomes claimable", () => {
    const { call, write } = fixture();
    call("start", { arch: "demo" });
    write("src/fresh.ts", "export {}\n");
    call("start", { arch: "demo", force: true });
    const ok = call("write_ok", { agent: "auth-1", path: "src/fresh.ts" });
    expect(ok.ok).toBe(false);
    if (!ok.ok) expect(ok.error).toBe("no_lease");
  });

  test("a deleted pre-existing file still needs a claim", () => {
    const { call, lease, repoRoot } = fixture();
    call("start", { arch: "demo" });
    rmSync(join(repoRoot, "src", "a.ts"));
    const row = lease("auth-1", "src/a.ts", "restore");
    expect(row.ok).toBe(true);
  });
});

describe("name", () => {
  test("an agent reserves a name and a second caller is rejected", () => {
    const { call } = fixture();
    call("start", { arch: "demo" });
    const named = call("name", { agent: "session-refresh" });
    expect(named.ok).toBe(true);
    if (!named.ok || !named.token) {
      throw new Error("expected a token");
    }
    const look = call("look");
    expect(look.ok).toBe(true);
    if (look.ok) expect(look.names?.map((row) => row.agent_id)).toEqual(["session-refresh"]);
    const again = call("name", { agent: "session-refresh", token: named.token });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.token).toBe(named.token);
    const taken = call("name", { agent: "session-refresh" });
    expect(taken.ok).toBe(false);
    if (!taken.ok) expect(taken.error).toBe("name_taken");
    const rename = call("name", { agent: "other-name", token: named.token });
    expect(rename.ok).toBe(false);
    if (!rename.ok) expect(rename.error).toBe("already_named");
  });

  test("a dead pid frees the name and reap drops it", () => {
    const { call, killPid } = fixture();
    call("start", { arch: "demo" });
    const named = call("name", { agent: "mcp-1", pid: 1001 });
    expect(named.ok).toBe(true);
    killPid(1001);
    const reclaimed = call("name", { agent: "mcp-1", pid: 1002 });
    expect(reclaimed.ok).toBe(true);
    if (named.ok && reclaimed.ok) expect(reclaimed.token).not.toBe(named.token);
    killPid(1002);
    const reaped = call("reap");
    expect(reaped.ok).toBe(true);
    const look = call("look");
    if (look.ok) expect(look.names).toEqual([]);
  });

  test("a cli name with no pid survives reap", () => {
    const { call } = fixture();
    call("start", { arch: "demo" });
    call("name", { agent: "session-refresh" });
    call("reap");
    const look = call("look");
    if (look.ok) expect(look.names?.map((row) => row.agent_id)).toEqual(["session-refresh"]);
  });

  test("force clears names", () => {
    const { call } = fixture();
    call("start", { arch: "demo" });
    call("name", { agent: "session-refresh" });
    call("start", { arch: "demo", force: true });
    const look = call("look");
    if (look.ok) expect(look.names).toEqual([]);
  });
});

describe("reup", () => {
  test("extends expires_at", () => {
    const { call, lease } = fixture();
    call("start", { arch: "demo" });
    lease("auth-1", "src/a.ts", "a");
    const r = call("reup", { agent: "auth-1" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.row?.expires_at).toBe("2026-09-18T19:52:00Z");
  });
});
