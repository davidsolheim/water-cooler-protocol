import { canConnect, rpc } from "./client.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot, wcpDir } from "./paths.ts";
import type { RpcResponse } from "./rpc.ts";

type JsonRpc = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

let sessionName: { agent: string; token: string } | undefined;

const TOOLS = [
  {
    name: "wcp_name",
    description:
      "Reserve this agent's self-chosen id for the run. Call once before other WCP tools. On name_taken, pick a different id.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short id, for example session-refresh or tw-331." },
      },
      required: ["name"],
    },
  },
  {
    name: "wcp_look",
    description: "Read the WCP occupancy board (arch, names, live leases, drift).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "wcp_acquire",
    description:
      "Claim one pre-existing file. Requires a test file already written that names the path. Refuses test files and new files.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string" },
        path: { type: "string" },
        doing: { type: "string" },
        scope: { type: "string" },
        test: { type: "string", description: "Test file written first. Must name this path." },
      },
      required: ["path", "doing", "test"],
    },
  },
  {
    name: "wcp_release",
    description: "Release this agent's lease.",
    inputSchema: {
      type: "object",
      properties: { agent: { type: "string" } },
    },
  },
  {
    name: "wcp_reup",
    description: "Extend expires_at while still flushing this burst. Do not hold through tests.",
    inputSchema: {
      type: "object",
      properties: { agent: { type: "string" } },
    },
  },
  {
    name: "wcp_overtake",
    description:
      "Take an idle lease on a pre-existing file to finish that work. Requires your own test naming the path.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string" },
        path: { type: "string" },
        test: { type: "string", description: "Test file written first. Must name this path." },
      },
      required: ["path", "test"],
    },
  },
  {
    name: "wcp_write_ok",
    description:
      "For a pre-existing file, fail closed without a live non-drift lease. Test files and new files pass with no lease.",
    inputSchema: {
      type: "object",
      properties: { agent: { type: "string" }, path: { type: "string" } },
      required: ["path"],
    },
  },
] as const;

function writeMessage(obj: unknown): void {
  const json = JSON.stringify(obj);
  const body = Buffer.from(json, "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function agentOf(params: Record<string, unknown> | undefined): string | undefined {
  const a = params?.agent;
  if (typeof a === "string" && a) {
    return a;
  }
  if (process.env.WCP_AGENT) {
    return process.env.WCP_AGENT;
  }
  return sessionName?.agent;
}

async function ensureDaemon(root: string): Promise<void> {
  if (await canConnect(root)) {
    return;
  }
  mkdirSync(wcpDir(root), { recursive: true });
  const logPath = join(wcpDir(root), "wcpd.log");
  writeFileSync(logPath, "");
  const entry = process.argv[1];
  const args =
    entry && (entry.endsWith("cli.ts") || entry.endsWith("mcp.ts") || entry.endsWith("cli.js"))
      ? [process.execPath, entry.endsWith("mcp.ts") ? entry.replace(/mcp\.ts$/, "cli.ts") : entry, "daemon"]
      : [process.execPath, "daemon"];
  const proc = Bun.spawn(args, {
    cwd: root,
    stdout: "ignore",
    stderr: Bun.file(logPath),
    stdin: "ignore",
    env: process.env,
    detached: true,
  });
  proc.unref();
  for (let i = 0; i < 50; i++) {
    await Bun.sleep(40);
    if (await canConnect(root)) {
      return;
    }
  }
  throw new Error("wcpd failed to start; see .WCP/wcpd.log");
}

async function callTool(name: string, params: Record<string, unknown> | undefined): Promise<RpcResponse> {
  const root = findRepoRoot();
  await ensureDaemon(root);
  const agent = agentOf(params);
  switch (name) {
    case "wcp_name": {
      const requested =
        (typeof params?.name === "string" && params.name) ||
        (typeof params?.agent === "string" && params.agent) ||
        sessionName?.agent;
      const res = await rpc(root, {
        id: "mcp",
        method: "name",
        params: { agent: requested, token: sessionName?.token, pid: process.pid },
      });
      if (res.ok && res.agent && res.token) {
        sessionName = { agent: res.agent, token: res.token };
      }
      return res;
    }
    case "wcp_look":
      return rpc(root, { id: "mcp", method: "look" });
    case "wcp_acquire":
      return rpc(root, {
        id: "mcp",
        method: "acquire",
        params: {
          agent,
          path: params?.path,
          doing: params?.doing,
          scope: params?.scope ?? "",
          test: params?.test,
          pid: process.pid,
        },
      });
    case "wcp_release":
      return rpc(root, { id: "mcp", method: "release", params: { agent } });
    case "wcp_reup":
      return rpc(root, { id: "mcp", method: "reup", params: { agent } });
    case "wcp_overtake":
      return rpc(root, {
        id: "mcp",
        method: "overtake",
        params: { agent, path: params?.path, test: params?.test, pid: process.pid },
      });
    case "wcp_write_ok":
      return rpc(root, { id: "mcp", method: "write_ok", params: { agent, path: params?.path } });
    default:
      return { id: "mcp", ok: false, error: "invalid", message: `unknown tool ${name}` };
  }
}

function handleRpc(msg: JsonRpc): Promise<void> | void {
  if (msg.method && msg.id === undefined) {
    return;
  }
  const id = msg.id ?? null;
  if (msg.method === "initialize") {
    writeMessage({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "wcp", version: "1.0.0" },
      },
    });
    return;
  }
  if (msg.method === "tools/list" || msg.method === "list_tools") {
    writeMessage({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }
  if (msg.method === "tools/call" || msg.method === "call_tool") {
    const name = String(msg.params?.name ?? "");
    const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
    return callTool(name, args).then((res) => {
      writeMessage({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(res) }],
          isError: res.ok === false,
        },
      });
    });
  }
  if (msg.method === "ping") {
    writeMessage({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  writeMessage({
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `unknown method ${msg.method}` },
  });
}

export async function runMcp(): Promise<void> {
  let buf = Buffer.alloc(0);
  for await (const chunk of Bun.stdin.stream()) {
    buf = Buffer.concat([buf, Buffer.from(chunk)]);
    while (true) {
      const split = buf.indexOf("\r\n\r\n");
      if (split < 0) {
        break;
      }
      const header = buf.slice(0, split).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buf = buf.slice(split + 4);
        continue;
      }
      const len = Number(match[1]);
      const start = split + 4;
      if (buf.length < start + len) {
        break;
      }
      const body = buf.slice(start, start + len).toString("utf8");
      buf = buf.slice(start + len);
      let msg: JsonRpc;
      try {
        msg = JSON.parse(body) as JsonRpc;
      } catch {
        continue;
      }
      await handleRpc(msg);
    }
  }
}

export const MCP_TOOLS = TOOLS;
