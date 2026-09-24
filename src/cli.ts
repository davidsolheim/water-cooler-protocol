#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canConnect, rpc } from "./client.ts";
import { startDaemon } from "./daemon.ts";
import { ensureBarrels, ensureGitignore, installHooks } from "./git.ts";
import { findRepoRoot, wcpDir } from "./paths.ts";
import { DEFAULT_TTL_SEC } from "./protocol.ts";
import type { RpcMethod, RpcRequest, RpcResponse } from "./rpc.ts";

const USAGE = `Water Cooler Protocol (wcp)

Usage:
  wcp init --arch <text> [--branch dev] [--ttl-sec 60]
  wcp start --arch <text> [--branch dev] [--ttl-sec 60] [--force]
  wcp look [--json]
  wcp status
  wcp name <id>
  wcp acquire --path <existing-file> --test <test-file> --doing <text> [--scope <text>] [--agent <id>]
  wcp release [--agent <id>]
  wcp reup [--agent <id>]
  wcp overtake --path <existing-file> --test <test-file> [--agent <id>]
  wcp write-ok --path <file> [--agent <id>]
  wcp set-arch <text>
  wcp install-hooks
  wcp stop
  wcp daemon [--detach]
  wcp mcp

Env: WCP_AGENT is this agent's name. WCP_NAME_TOKEN proves it. Set both from \`wcp name\`.
`;

type Flags = {
  cmd: string;
  json: boolean;
  rest: Record<string, string | boolean>;
};

function parseArgv(argv: string[]): Flags {
  const cmd = argv[0] ?? "help";
  const json = argv.includes("--json");
  const rest: Record<string, string | boolean> = {};
  const args = argv.slice(1);
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--json") {
      continue;
    }
    if (a === "--force" || a === "--detach") {
      rest[a.slice(2)] = true;
      continue;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2).replace(/-/g, "_");
      const val = args[i + 1];
      if (val == null || val.startsWith("--")) {
        rest[key] = true;
      } else {
        rest[key] = val;
        i += 1;
      }
      continue;
    }
    if (cmd === "set-arch" || cmd === "set_arch") {
      rest.arch = rest.arch ? `${rest.arch} ${a}` : a;
    }
    if (cmd === "name" && rest.name == null) {
      rest.name = a;
    }
  }
  return { cmd, json, rest };
}

function flagStr(flags: Flags, key: string): string | undefined {
  const v = flags.rest[key];
  return typeof v === "string" ? v : undefined;
}

function agentOf(flags: Flags): string | undefined {
  return flagStr(flags, "agent") ?? process.env.WCP_AGENT;
}

function print(res: RpcResponse, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(res));
    return;
  }
  if (!res.ok) {
    const extra = res.existing
      ? ` (held by ${res.existing.agent_id} on ${res.existing.path}: ${res.existing.doing})`
      : "";
    console.error(`wcp: ${res.error}: ${res.message}${extra}`);
    return;
  }
  if (res.live) {
    console.log(`arch: ${res.arch ?? ""}`);
    console.log(`branch: ${res.branch ?? ""}`);
    console.log(`ttl_sec: ${res.ttl_sec ?? ""}`);
    if (res.live.length === 0) {
      console.log("live: (empty)");
    } else {
      console.log("live:");
      for (const row of res.live) {
        const marks = [row.expired ? "expired" : null, row.drift ? "drift" : null]
          .filter(Boolean)
          .join(",");
        console.log(
          `  ${row.agent_id}  ${row.path}  ${row.doing}${marks ? `  [${marks}]` : ""}`,
        );
      }
    }
    const names = res.names ?? [];
    if (names.length === 0) {
      console.log("names: (none)");
    } else {
      console.log(`names: ${names.map((named) => named.agent_id).join(", ")}`);
    }
    return;
  }
  if (res.token && res.agent) {
    console.log(`agent: ${res.agent}`);
    console.log(`export WCP_AGENT=${res.agent}`);
    console.log(`export WCP_NAME_TOKEN=${res.token}`);
    return;
  }
  if (res.row) {
    console.log(
      `${res.row.agent_id} ${res.row.path} until ${res.row.expires_at}${res.row.from_agent ? ` from ${res.row.from_agent}` : ""}`,
    );
    return;
  }
  if (res.arch != null) {
    console.log(`arch: ${res.arch}`);
    return;
  }
  if (res.released != null) {
    console.log(`released: ${res.released}`);
    return;
  }
  if (res.claim === "test") {
    console.log("test file: write it, no claim");
    return;
  }
  if (res.claim === "new_file") {
    console.log("new file: write it, no claim");
    return;
  }
  console.log("ok");
}

function daemonSpawnArgs(): string[] {
  const entry = process.argv[1];
  if (entry && (entry.endsWith("cli.ts") || entry.endsWith("cli.js"))) {
    return [process.execPath, entry, "daemon"];
  }
  return [process.execPath, "daemon"];
}

function spawnDaemon(root: string): void {
  mkdirSync(wcpDir(root), { recursive: true });
  const logPath = join(wcpDir(root), "wcpd.log");
  writeFileSync(logPath, "");
  const proc = Bun.spawn(daemonSpawnArgs(), {
    cwd: root,
    stdout: "ignore",
    stderr: Bun.file(logPath),
    stdin: "ignore",
    env: process.env,
    detached: true,
  });
  proc.unref();
}

async function ensureDaemon(root: string): Promise<void> {
  if (await canConnect(root)) {
    return;
  }
  spawnDaemon(root);
  for (let i = 0; i < 50; i++) {
    await Bun.sleep(40);
    if (await canConnect(root)) {
      return;
    }
  }
  throw new Error("wcpd failed to start; see .WCP/wcpd.log");
}

async function call(
  root: string,
  method: RpcMethod,
  params: Record<string, unknown> | undefined,
  json: boolean,
): Promise<number> {
  await ensureDaemon(root);
  const req: RpcRequest = { id: crypto.randomUUID(), method, params };
  const res = await rpc(root, req);
  print(res, json);
  return res.ok ? 0 : 1;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const flags = parseArgv(argv);
  if (flags.cmd === "help" || flags.cmd === "-h" || flags.cmd === "--help") {
    console.log(USAGE);
    return 0;
  }
  if (flags.cmd === "version" || flags.cmd === "--version" || flags.cmd === "-v") {
    console.log("1.0.0");
    return 0;
  }

  if (flags.cmd === "daemon") {
    const root = findRepoRoot();
    if (flags.rest.detach) {
      spawnDaemon(root);
      return 0;
    }
    startDaemon({ repoRoot: root });
    await new Promise(() => {
      /* park */
    });
    return 0;
  }

  if (flags.cmd === "mcp") {
    const { runMcp } = await import("./mcp.ts");
    await runMcp();
    return 0;
  }

  const root = findRepoRoot();

  if (flags.cmd === "install-hooks" || flags.cmd === "install_hooks") {
    installHooks(root);
    console.log("wcp: installed local git hooks");
    return 0;
  }

  if (flags.cmd === "init" || flags.cmd === "start") {
    const arch = flagStr(flags, "arch") ?? "";
    if (!arch) {
      console.error("wcp: --arch is required");
      return 1;
    }
    mkdirSync(wcpDir(root), { recursive: true });
    ensureGitignore(root);
    ensureBarrels(root);
    installHooks(root);
    const ttl = flagStr(flags, "ttl_sec");
    return call(
      root,
      "start",
      {
        arch,
        branch: flagStr(flags, "branch") ?? "dev",
        ttl_sec: ttl ? Number(ttl) : DEFAULT_TTL_SEC,
        force: flags.rest.force === true,
      },
      flags.json,
    );
  }

  if (flags.cmd === "look" || flags.cmd === "status") {
    return call(root, "look", undefined, flags.json);
  }

  if (flags.cmd === "name") {
    const requested = flagStr(flags, "name");
    const envAgent = process.env.WCP_AGENT;
    const envToken = process.env.WCP_NAME_TOKEN;
    if (envToken && envAgent && requested && requested !== envAgent) {
      print(
        {
          id: "cli",
          ok: false,
          error: "already_named",
          message: `this session is ${envAgent}`,
        },
        flags.json,
      );
      return 1;
    }
    const agent = requested ?? envAgent;
    if (!agent) {
      console.error("wcp: name requires an id, for example: wcp name session-refresh");
      return 1;
    }
    return call(root, "name", { agent, token: envToken }, flags.json);
  }

  if (flags.cmd === "set-arch" || flags.cmd === "set_arch") {
    const arch = flagStr(flags, "arch") ?? "";
    if (!arch) {
      console.error("wcp: arch text is required");
      return 1;
    }
    return call(root, "set_arch", { arch, human: true }, flags.json);
  }

  if (flags.cmd === "acquire") {
    const path = flagStr(flags, "path");
    const doing = flagStr(flags, "doing");
    const agent = agentOf(flags);
    if (!path || !doing || !agent) {
      console.error("wcp: acquire requires --path, --doing, and --agent or WCP_AGENT");
      return 1;
    }
    return call(
      root,
      "acquire",
      {
        agent,
        path,
        doing,
        scope: flagStr(flags, "scope") ?? "",
        test: flagStr(flags, "test"),
      },
      flags.json,
    );
  }

  if (flags.cmd === "release") {
    const agent = agentOf(flags);
    if (!agent) {
      console.error("wcp: --agent or WCP_AGENT is required");
      return 1;
    }
    return call(root, "release", { agent }, flags.json);
  }

  if (flags.cmd === "reup") {
    const agent = agentOf(flags);
    if (!agent) {
      console.error("wcp: --agent or WCP_AGENT is required");
      return 1;
    }
    return call(root, "reup", { agent }, flags.json);
  }

  if (flags.cmd === "overtake") {
    const path = flagStr(flags, "path");
    const agent = agentOf(flags);
    if (!path || !agent) {
      console.error("wcp: overtake requires --path and --agent or WCP_AGENT");
      return 1;
    }
    return call(root, "overtake", { agent, path, test: flagStr(flags, "test") }, flags.json);
  }

  if (flags.cmd === "write-ok" || flags.cmd === "write_ok") {
    const path = flagStr(flags, "path");
    const agent = agentOf(flags);
    if (!path || !agent) {
      console.error("wcp: write-ok requires --path and --agent or WCP_AGENT");
      return 1;
    }
    return call(root, "write_ok", { agent, path }, flags.json);
  }

  if (flags.cmd === "stop") {
    if (!(await canConnect(root))) {
      console.log("wcp: daemon not running");
      return 0;
    }
    return call(root, "stop", undefined, flags.json);
  }

  if (flags.cmd === "reap") {
    return call(root, "reap", undefined, flags.json);
  }

  console.error(USAGE);
  return 1;
}

if (import.meta.main) {
  main().then((code) => process.exit(code), (err) => {
    console.error(`wcp: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
