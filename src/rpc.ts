import type { Database } from "bun:sqlite";
import {
  DEFAULT_TTL_SEC,
  addSecondsIso,
  isExpired,
  normalizeBoardPath,
  validateAgentId,
} from "./protocol.ts";

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
  | "reap";

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
};

export type RpcResponse = RpcOk | RpcErr;

export type RpcCtx = {
  db: Database;
  repoRoot: string;
  now: () => string;
  gitBranch: () => string;
  pidAlive: (pid: number) => boolean;
  sha256: (boardPath: string) => string;
};

type RunRow = {
  id: number;
  branch: string;
  arch: string;
  ttl_sec: number;
  created_at: string;
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
      `INSERT INTO live (agent_id, path, doing, scope, from_agent, leased_at, expires_at, sha256, pid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  }
  if (!existing) {
    ctx.db
      .query(
        "INSERT INTO run (id, branch, arch, ttl_sec, created_at) VALUES (1, ?, ?, ?, ?)",
      )
      .run(branch, arch, ttl_sec, now);
  } else {
    ctx.db
      .query("UPDATE run SET branch = ?, arch = ?, ttl_sec = ? WHERE id = 1")
      .run(branch, arch, ttl_sec);
  }
  return { id: req.id, ok: true, arch, branch, ttl_sec };
}

function handleLook(ctx: RpcCtx, req: RpcRequest): RpcResponse {
  const run = requireRun(ctx, req.id);
  if ("ok" in run && run.ok === false) {
    return run;
  }
  const now = ctx.now();
  const live = allLive(ctx.db).map((row) => decorate(row, ctx, now));
  return {
    id: req.id,
    ok: true,
    arch: run.arch,
    branch: run.branch,
    ttl_sec: run.ttl_sec,
    now,
    live,
  };
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
  const now = ctx.now();
  const onPath = rowByPath(ctx.db, path);
  if (!onPath) {
    return err(req.id, "no_lease", "no lease on path");
  }
  if (!isIdle(onPath, ctx, now)) {
    return err(req.id, "not_idle", "lease is still live", decorate(onPath, ctx, now));
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
  return { id: req.id, ok: true, released };
}

export function handle(ctx: RpcCtx, req: RpcRequest): RpcResponse {
  try {
    switch (req.method) {
      case "look":
        return handleLook(ctx, req);
      case "start":
        return handleStart(ctx, req);
      case "stop": {
        const n = (ctx.db.query("SELECT COUNT(*) AS c FROM live").get() as { c: number }).c;
        ctx.db.exec("DELETE FROM live");
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
      default:
        return err(req.id, "invalid", `unknown method: ${String(req.method)}`);
    }
  } catch (e) {
    return err(req.id, "invalid", e instanceof Error ? e.message : String(e));
  }
}
