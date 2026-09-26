import { readFileSync, statSync } from "node:fs";
import type { Database } from "bun:sqlite";
import { isWcpTreePath } from "./paths.ts";
import {
  DEFAULT_TTL_SEC,
  absFromBoard,
  addSecondsIso,
  isExpired,
  isTestPath,
  normalizeBoardPath,
  testMarksPath,
  validateAgentId,
} from "./protocol.ts";

const TEST_MTIME_GRACE_MS = 2000;

export type LiveRow = {
  agent_id: string;
  path: string;
  doing: string;
  scope: string;
  from_agent: string | null;
  leased_at: string;
  expires_at: string;
  sha256: string;
  pid: number | null;
  test_path: string;
  drift: boolean;
  expired: boolean;
};

export type RpcMethod =
  | "look"
  | "start"
  | "stop"
  | "set_arch"
  | "acquire"
  | "release"
  | "reup"
  | "overtake"
  | "write_ok"
  | "reap"
  | "name";

export type RpcRequest = {
  id: string;
  method: RpcMethod;
  params?: Record<string, unknown>;
};

export type RpcErrorCode =
  | "conflict"
  | "agent_busy"
  | "not_idle"
  | "no_lease"
  | "wrong_path"
  | "expired"
  | "drift"
  | "wrong_branch"
  | "no_run"
  | "no_test"
  | "new_file"
  | "test_file"
  | "name_taken"
  | "already_named"
  | "forbidden"
  | "invalid"
  | "stopping";

export type RpcErr = {
  id: string;
  ok: false;
  error: RpcErrorCode;
  message: string;
  existing?: LiveRow;
};

export type RpcOk = {
  id: string;
  ok: true;
  arch?: string;
  branch?: string;
  ttl_sec?: number;
  now?: string;
  live?: LiveRow[];
  row?: LiveRow;
  released?: number;
  claim?: "test" | "new_file";
  agent?: string;
  token?: string;
  names?: ActorName[];
};

export type ActorName = {
  agent_id: string;
  named_at: string;
  pid: number | null;
};

export type RpcResponse = RpcOk | RpcErr;

export type RpcCtx = {
  db: Database;
  repoRoot: string;
  now: () => string;
  gitBranch: () => string;
  pidAlive: (pid: number) => boolean;
  sha256: (boardPath: string) => string;
  listExisted: () => string[];
};

type RunRow = {
  id: number;
  branch: string;
  arch: string;
  ttl_sec: number;
  created_at: string;
  snap_at: string | null;
};

type LiveDb = {
  agent_id: string;
  path: string;
  doing: string;
  scope: string;
  from_agent: string | null;
  leased_at: string;
  expires_at: string;
  sha256: string;
  pid: number | null;
  test_path: string;
};

function str(params: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = params?.[key];
  return typeof v === "string" ? v : undefined;
}

function bool(params: Record<string, unknown> | undefined, key: string): boolean {
  return params?.[key] === true;
}

function num(params: Record<string, unknown> | undefined, key: string): number | undefined {
  const v = params?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function err(
  id: string,
  error: RpcErrorCode,
  message: string,
  existing?: LiveRow,
): RpcErr {
  return existing ? { id, ok: false, error, message, existing } : { id, ok: false, error, message };
}

function getRun(db: Database): RunRow | undefined {
  return db.query("SELECT * FROM run WHERE id = 1").get() as RunRow | undefined;
}

function cleanExistedPath(raw: string): string | null {
  const rel = raw.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!rel || rel.startsWith("/") || isWcpTreePath(rel) || rel.split("/").includes("..")) {
    return null;
  }
  return rel;
}

function captureExisted(ctx: RpcCtx): void {
  const now = ctx.now();
  const paths = [...new Set(ctx.listExisted().map(cleanExistedPath).filter((p): p is string => !!p))];
  const insert = ctx.db.query("INSERT INTO existed (path) VALUES (?)");
  const tx = ctx.db.transaction(() => {
    ctx.db.exec("DELETE FROM existed");
    for (const path of paths) {
      insert.run(path);
    }
    ctx.db.query("UPDATE run SET snap_at = ? WHERE id = 1").run(now);
  });
  tx();
}

function ensureSnapshot(ctx: RpcCtx): void {
  const run = getRun(ctx.db);
  if (!run || run.snap_at) {
    return;
  }
  captureExisted(ctx);
}

function existedHas(db: Database, path: string): boolean {
  return !!db.query("SELECT 1 AS ok FROM existed WHERE path = ?").get(path);
}

function requireRun(ctx: RpcCtx, id: string): RunRow | RpcErr {
  const run = getRun(ctx.db);
  if (!run) {
    return err(id, "no_run", "no run; wcp start --arch \"…\" first");
  }
  return run;
}

function isIdle(row: LiveDb, ctx: RpcCtx, now: string): boolean {
  if (isExpired(row.expires_at, now)) {
    return true;
  }
  if (row.pid != null && !ctx.pidAlive(row.pid)) {
    return true;
  }
  return false;
}

function decorate(row: LiveDb, ctx: RpcCtx, now: string): LiveRow {
  const disk = ctx.sha256(row.path);
  return {
    ...row,
    from_agent: row.from_agent ?? null,
    pid: row.pid ?? null,
    drift: disk !== row.sha256,
    expired: isIdle(row, ctx, now),
  };
}

function rowByAgent(db: Database, agent: string): LiveDb | undefined {
  return db.query("SELECT * FROM live WHERE agent_id = ?").get(agent) as LiveDb | undefined;
}

function rowByPath(db: Database, path: string): LiveDb | undefined {
  return db.query("SELECT * FROM live WHERE path = ?").get(path) as LiveDb | undefined;
}

function allLive(db: Database): LiveDb[] {
  return db.query("SELECT * FROM live ORDER BY leased_at ASC, agent_id ASC").all() as LiveDb[];
}

function insertLive(
  ctx: RpcCtx,
  row: {
    agent_id: string;
    path: string;
    doing: string;
    scope: string;
    from_agent: string | null;
    pid: number | null;
    test_path: string;
  },
): LiveRow {
  const now = ctx.now();
  const run = getRun(ctx.db);
  if (!run) {
    throw new Error("insertLive without run");
  }
  const leased_at = now;
  const expires_at = addSecondsIso(now, run.ttl_sec);
  const sha256 = ctx.sha256(row.path);
  ctx.db
    .query(
      `INSERT INTO live (agent_id, path, doing, scope, from_agent, leased_at, expires_at, sha256, pid, test_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.agent_id,
      row.path,
      row.doing,
      row.scope,
      row.from_agent,
      leased_at,
      expires_at,
      sha256,
      row.pid,
      row.test_path,
    );
  return decorate(
    {
      ...row,
      leased_at,
      expires_at,
      sha256,
    },
    ctx,
    now,
  );
}

function deleteAgent(db: Database, agent: string): void {
  db.query("DELETE FROM live WHERE agent_id = ?").run(agent);
}

function parsePath(ctx: RpcCtx, id: string, raw: string | undefined): string | RpcErr {
  if (!raw) {
    return err(id, "invalid", "path is required");
  }
  try {
    return normalizeBoardPath(ctx.repoRoot, raw);
  } catch (e) {
    return err(id, "invalid", e instanceof Error ? e.message : String(e));
  }
}

function parseAgent(id: string, raw: string | undefined): string | RpcErr {
  if (!raw) {
    return err(id, "invalid", "agent is required");
  }
  try {
    return validateAgentId(raw);
  } catch (e) {
    return err(id, "invalid", e instanceof Error ? e.message : String(e));
  }
}

function handleStart(ctx: RpcCtx, req: RpcRequest): RpcResponse {
  const arch = str(req.params, "arch") ?? "";
  const branch = str(req.params, "branch") ?? "dev";
  const ttl_sec = num(req.params, "ttl_sec") ?? DEFAULT_TTL_SEC;
  const force = bool(req.params, "force");
  if (ttl_sec < 5 || ttl_sec > 3600) {
    return err(req.id, "invalid", "ttl_sec must be between 5 and 3600");
  }
  const now = ctx.now();
  const existing = getRun(ctx.db);
  if (force) {
    ctx.db.exec("DELETE FROM live");
    ctx.db.exec("DELETE FROM actor");
  }
  if (!existing) {
    ctx.db
      .query(
        "INSERT INTO run (id, branch, arch, ttl_sec, created_at, snap_at) VALUES (1, ?, ?, ?, ?, NULL)",
      )
      .run(branch, arch, ttl_sec, now);
  } else {
    ctx.db
      .query("UPDATE run SET branch = ?, arch = ?, ttl_sec = ? WHERE id = 1")
      .run(branch, arch, ttl_sec);
  }
  const run = getRun(ctx.db);
  if (force || !run?.snap_at) {
    captureExisted(ctx);
  }
  return { id: req.id, ok: true, arch, branch, ttl_sec };
}

function requireTestProof(
  ctx: RpcCtx,
  id: string,
  agent: string,
  sourcePath: string,
  run: RunRow,
  rawTest: string | undefined,
): string | RpcErr {
  if (!rawTest) {
    return err(
      id,
      "no_test",
      `write a test naming ${sourcePath} before claiming it. Do not claim the test file.`,
    );
  }
  const testPath = parsePath(ctx, id, rawTest);
  if (typeof testPath !== "string") {
    return err(id, "no_test", testPath.message);
  }
  if (!isTestPath(testPath)) {
    return err(id, "no_test", `test path is not a test file: ${testPath}`);
  }
  if (testPath === sourcePath) {
    return err(id, "no_test", "the test file and the claimed file must be different");
  }
  const abs = absFromBoard(ctx.repoRoot, testPath);
  let text = "";
  let mtime = 0;
  try {
    const st = statSync(abs);
    if (!st.isFile()) {
      return err(id, "no_test", `test path is not a file: ${testPath}`);
    }
    mtime = st.mtimeMs;
    text = readFileSync(abs, "utf8");
  } catch {
    return err(
      id,
      "no_test",
      `test file does not exist yet: ${testPath}. Write it before claiming ${sourcePath}.`,
    );
  }
  if (mtime + TEST_MTIME_GRACE_MS < Date.parse(run.created_at)) {
    return err(id, "no_test", `test file ${testPath} was not written during this run`);
  }
  if (!testMarksPath(text, agent, sourcePath)) {
    return err(id, "no_test", `test file must contain a line: WCP ${agent}: ${sourcePath} …`);
  }
  return testPath;
}

function handleLook(ctx: RpcCtx, req: RpcRequest): RpcResponse {
  const run = requireRun(ctx, req.id);
  if ("ok" in run && run.ok === false) {
    return run;
  }
  const now = ctx.now();
  const live = allLive(ctx.db).map((row) => decorate(row, ctx, now));
  const names = ctx.db
    .query("SELECT agent_id, named_at, pid FROM actor ORDER BY named_at ASC, agent_id ASC")
    .all() as ActorName[];
  return {
    id: req.id,
    ok: true,
    arch: run.arch,
    branch: run.branch,
    ttl_sec: run.ttl_sec,
    now,
    live,
    names,
  };
}

type ActorDb = {
  agent_id: string;
  token: string;
  named_at: string;
  pid: number | null;
};

function actorById(db: Database, agent: string): ActorDb | undefined {
  return db.query("SELECT * FROM actor WHERE agent_id = ?").get(agent) as ActorDb | undefined;
}

function actorByToken(db: Database, token: string): ActorDb | undefined {
  return db.query("SELECT * FROM actor WHERE token = ?").get(token) as ActorDb | undefined;
}

function handleName(ctx: RpcCtx, req: RpcRequest): RpcResponse {
  const run = requireRun(ctx, req.id);
  if ("ok" in run && run.ok === false) {
    return run;
  }
  const agent = parseAgent(req.id, str(req.params, "agent"));
  if (typeof agent !== "string") {
    return agent;
  }
  const token = str(req.params, "token");
  const pid = num(req.params, "pid") ?? null;
  const byToken = token ? actorByToken(ctx.db, token) : undefined;
  if (byToken && byToken.agent_id !== agent) {
    return err(req.id, "already_named", `this session is ${byToken.agent_id}`);
  }
  const existing = actorById(ctx.db, agent);
  const now = ctx.now();
  if (!existing) {
    const minted = crypto.randomUUID().replace(/-/g, "");
    ctx.db
      .query("INSERT INTO actor (agent_id, token, named_at, pid) VALUES (?, ?, ?, ?)")
      .run(agent, minted, now, pid);
    return { id: req.id, ok: true, agent, token: minted };
  }
  if (byToken && byToken.agent_id === agent) {
    return { id: req.id, ok: true, agent, token: existing.token };
  }
  if (existing.pid != null && !ctx.pidAlive(existing.pid)) {
    const minted = crypto.randomUUID().replace(/-/g, "");
    ctx.db
      .query("UPDATE actor SET token = ?, named_at = ?, pid = ? WHERE agent_id = ?")
      .run(minted, now, pid, agent);
    return { id: req.id, ok: true, agent, token: minted };
  }
  return err(req.id, "name_taken", `name ${agent} is already in use; pick another id`);
}

function handleSetArch(ctx: RpcCtx, req: RpcRequest): RpcResponse {
  if (!bool(req.params, "human")) {
    return err(req.id, "forbidden", "set_arch is human-only");
  }
  const run = requireRun(ctx, req.id);
  if ("ok" in run && run.ok === false) {
    return run;
  }
  const arch = str(req.params, "arch");
  if (arch == null) {
    return err(req.id, "invalid", "arch is required");
  }
  ctx.db.query("UPDATE run SET arch = ? WHERE id = 1").run(arch);
  return { id: req.id, ok: true, arch, branch: run.branch, ttl_sec: run.ttl_sec };
}

function handleAcquire(ctx: RpcCtx, req: RpcRequest): RpcResponse {
  const run = requireRun(ctx, req.id);
  if ("ok" in run && run.ok === false) {
    return run;
  }
  const agent = parseAgent(req.id, str(req.params, "agent"));
  if (typeof agent !== "string") {
    return agent;
  }
  const path = parsePath(ctx, req.id, str(req.params, "path"));
  if (typeof path !== "string") {
    return path;
  }
  const doing = str(req.params, "doing") ?? "";
  if (!doing) {
    return err(req.id, "invalid", "doing is required");
  }
  if (isTestPath(path)) {
    return err(
      req.id,
      "test_file",
      "test files are not claimed; write the test, then claim the existing source file",
    );
  }
  if (!existedHas(ctx.db, path)) {
    return err(
      req.id,
      "new_file",
      "path was not in the tree when the run started; write it directly, no claim",
    );
  }
  const proof = requireTestProof(ctx, req.id, agent, path, run, str(req.params, "test"));
  if (typeof proof !== "string") {
    return proof;
  }
  const scope = str(req.params, "scope") ?? "";
  const pid = num(req.params, "pid") ?? null;
  const now = ctx.now();
  const onPath = rowByPath(ctx.db, path);
  if (onPath && onPath.agent_id !== agent) {
    return err(req.id, "conflict", `path leased by ${onPath.agent_id}`, decorate(onPath, ctx, now));
  }
  const mine = rowByAgent(ctx.db, agent);
  if (mine && mine.path !== path && !isIdle(mine, ctx, now)) {
    return err(req.id, "agent_busy", `agent holds ${mine.path}`, decorate(mine, ctx, now));
  }
  if (mine) {
    deleteAgent(ctx.db, agent);
  }
  const row = insertLive(ctx, {
    agent_id: agent,
    path,
    doing,
    scope,
    from_agent: null,
    pid,
    test_path: proof,
  });
  return { id: req.id, ok: true, row };
}

function handleRelease(ctx: RpcCtx, req: RpcRequest): RpcResponse {
  const agent = parseAgent(req.id, str(req.params, "agent"));
  if (typeof agent !== "string") {
    return agent;
  }
  deleteAgent(ctx.db, agent);
  return { id: req.id, ok: true, released: 1 };
}

function handleReup(ctx: RpcCtx, req: RpcRequest): RpcResponse {
  const run = requireRun(ctx, req.id);
  if ("ok" in run && run.ok === false) {
    return run;
  }
  const agent = parseAgent(req.id, str(req.params, "agent"));
  if (typeof agent !== "string") {
    return agent;
  }
  const now = ctx.now();
  const mine = rowByAgent(ctx.db, agent);
  if (!mine) {
    return err(req.id, "no_lease", "agent holds no lease");
  }
  if (isIdle(mine, ctx, now)) {
    return err(req.id, "expired", "lease expired; acquire again", decorate(mine, ctx, now));
  }
  const expires_at = addSecondsIso(now, run.ttl_sec);
  ctx.db.query("UPDATE live SET expires_at = ? WHERE agent_id = ?").run(expires_at, agent);
  const updated = rowByAgent(ctx.db, agent);
  if (!updated) {
    return err(req.id, "no_lease", "lease vanished");
  }
  return { id: req.id, ok: true, row: decorate(updated, ctx, now) };
}

function handleOvertake(ctx: RpcCtx, req: RpcRequest): RpcResponse {
  const run = requireRun(ctx, req.id);
  if ("ok" in run && run.ok === false) {
    return run;
  }
  const agent = parseAgent(req.id, str(req.params, "agent"));
  if (typeof agent !== "string") {
    return agent;
  }
  const path = parsePath(ctx, req.id, str(req.params, "path"));
  if (typeof path !== "string") {
    return path;
  }
  if (isTestPath(path)) {
    return err(req.id, "test_file", "test files are not claimed");
  }
  if (!existedHas(ctx.db, path)) {
    return err(req.id, "new_file", "path was not in the tree when the run started; nothing to overtake");
  }
  const now = ctx.now();
  const onPath = rowByPath(ctx.db, path);
  if (!onPath) {
    return err(req.id, "no_lease", "no lease on path");
  }
  if (!isIdle(onPath, ctx, now)) {
    return err(req.id, "not_idle", "lease is still live", decorate(onPath, ctx, now));
  }
  const proof = requireTestProof(ctx, req.id, agent, path, run, str(req.params, "test"));
  if (typeof proof !== "string") {
    return proof;
  }
  const mine = rowByAgent(ctx.db, agent);
  if (mine && mine.path !== path && !isIdle(mine, ctx, now)) {
    return err(req.id, "agent_busy", `agent holds ${mine.path}`, decorate(mine, ctx, now));
  }
  const from_agent = onPath.agent_id;
  const doing = onPath.doing;
  const scope = onPath.scope;
  ctx.db.query("DELETE FROM live WHERE path = ?").run(path);
  if (mine) {
    deleteAgent(ctx.db, agent);
  }
  const row = insertLive(ctx, {
    agent_id: agent,
    path,
    doing,
    scope,
    from_agent,
    pid: num(req.params, "pid") ?? null,
    test_path: proof,
  });
  return { id: req.id, ok: true, row };
}

function handleWriteOk(ctx: RpcCtx, req: RpcRequest): RpcResponse {
  const run = requireRun(ctx, req.id);
  if ("ok" in run && run.ok === false) {
    return run;
  }
  const agent = parseAgent(req.id, str(req.params, "agent"));
  if (typeof agent !== "string") {
    return agent;
  }
  const path = parsePath(ctx, req.id, str(req.params, "path"));
  if (typeof path !== "string") {
    return path;
  }
  if (ctx.gitBranch() !== run.branch) {
    return err(
      req.id,
      "wrong_branch",
      `HEAD is ${ctx.gitBranch()}; run.branch is ${run.branch}`,
    );
  }
  if (isTestPath(path)) {
    return { id: req.id, ok: true, claim: "test" };
  }
  if (!existedHas(ctx.db, path)) {
    return { id: req.id, ok: true, claim: "new_file" };
  }
  const now = ctx.now();
  const mine = rowByAgent(ctx.db, agent);
  if (!mine) {
    return err(req.id, "no_lease", "agent holds no lease");
  }
  if (mine.path !== path) {
    return err(req.id, "wrong_path", `lease is on ${mine.path}`, decorate(mine, ctx, now));
  }
  if (isIdle(mine, ctx, now)) {
    return err(req.id, "expired", "lease expired", decorate(mine, ctx, now));
  }
  const disk = ctx.sha256(path);
  if (disk !== mine.sha256) {
    return err(req.id, "drift", "file changed since acquire", decorate(mine, ctx, now));
  }
  return { id: req.id, ok: true, row: decorate(mine, ctx, now) };
}

function handleReap(ctx: RpcCtx, req: RpcRequest): RpcResponse {
  const now = ctx.now();
  const rows = allLive(ctx.db);
  let released = 0;
  for (const row of rows) {
    if (isIdle(row, ctx, now)) {
      deleteAgent(ctx.db, row.agent_id);
      released += 1;
    }
  }
  const actors = ctx.db.query("SELECT agent_id, pid FROM actor").all() as Array<{
    agent_id: string;
    pid: number | null;
  }>;
  for (const actor of actors) {
    if (actor.pid != null && !ctx.pidAlive(actor.pid)) {
      ctx.db.query("DELETE FROM actor WHERE agent_id = ?").run(actor.agent_id);
    }
  }
  return { id: req.id, ok: true, released };
}

export function handle(ctx: RpcCtx, req: RpcRequest): RpcResponse {
  try {
    if (req.method !== "start") {
      ensureSnapshot(ctx);
    }
    switch (req.method) {
      case "look":
        return handleLook(ctx, req);
      case "start":
        return handleStart(ctx, req);
      case "stop": {
        const n = (ctx.db.query("SELECT COUNT(*) AS c FROM live").get() as { c: number }).c;
        ctx.db.exec("DELETE FROM live");
        ctx.db.exec("DELETE FROM actor");
        return { id: req.id, ok: true, released: n };
      }
      case "set_arch":
        return handleSetArch(ctx, req);
      case "acquire":
        return handleAcquire(ctx, req);
      case "release":
        return handleRelease(ctx, req);
      case "reup":
        return handleReup(ctx, req);
      case "overtake":
        return handleOvertake(ctx, req);
      case "write_ok":
        return handleWriteOk(ctx, req);
      case "reap":
        return handleReap(ctx, req);
      case "name":
        return handleName(ctx, req);
      default:
        return err(req.id, "invalid", `unknown method: ${String(req.method)}`);
    }
  } catch (e) {
    return err(req.id, "invalid", e instanceof Error ? e.message : String(e));
  }
}
