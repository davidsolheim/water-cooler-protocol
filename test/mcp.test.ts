import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { gitRepo } from "./helpers.ts";

const dirs: string[] = [];
const cli = join(import.meta.dir, "../src/cli.ts");

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    Bun.spawnSync([process.execPath, cli, "stop"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    rmSync(dir, { recursive: true, force: true });
  }
});

function frame(obj: unknown): Uint8Array {
  const json = JSON.stringify(obj);
  const body = Buffer.from(json, "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
  return Buffer.concat([header, body]);
}

function parseFrames(buf: Buffer): unknown[] {
  const out: unknown[] = [];
  let rest = buf;
  while (true) {
    const split = rest.indexOf("\r\n\r\n");
    if (split < 0) {
      break;
    }
    const header = rest.slice(0, split).toString("utf8");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      break;
    }
    const len = Number(match[1]);
    const start = split + 4;
    if (rest.length < start + len) {
      break;
    }
    out.push(JSON.parse(rest.slice(start, start + len).toString("utf8")));
    rest = rest.slice(start + len);
  }
  return out;
}

describe("mcp", () => {
  test("initialize, list tools, look", async () => {
    const root = gitRepo();
    dirs.push(root);
    const init = Bun.spawnSync([process.execPath, cli, "init", "--arch", "demo", "--json"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(init.exitCode).toBe(0);

    const proc = Bun.spawn([process.execPath, cli, "mcp"], {
      cwd: root,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    proc.stdin.write(
      frame({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } },
      }),
    );
    proc.stdin.write(frame({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
    proc.stdin.write(frame({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "wcp_look", arguments: {} } }));
    proc.stdin.end();

    const stdout = await new Response(proc.stdout).arrayBuffer();
    const msgs = parseFrames(Buffer.from(stdout)) as Array<Record<string, unknown>>;
    const codes = await proc.exited;
    expect(codes).toBe(0);
    expect(msgs.length).toBeGreaterThanOrEqual(3);
    const initRes = msgs[0] as { result?: { serverInfo?: { name?: string } } };
    expect(initRes.result?.serverInfo?.name).toBe("wcp");
    const list = msgs[1] as { result?: { tools?: Array<{ name: string }> } };
    const names = (list.result?.tools ?? []).map((t) => t.name);
    expect(names).toContain("wcp_look");
    expect(names).toContain("wcp_acquire");
    expect(names).not.toContain("wcp_set_arch");
    const look = msgs[2] as { result?: { content?: Array<{ text: string }> } };
    const board = JSON.parse(look.result?.content?.[0]?.text ?? "{}");
    expect(board.ok).toBe(true);
    expect(board.arch).toBe("demo");
  });
});
