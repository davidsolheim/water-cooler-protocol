import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rpc } from "../src/client.ts";
import { startDaemon, type Daemon } from "../src/daemon.ts";
import { runMdPath } from "../src/paths.ts";
import { gitRepo } from "./helpers.ts";

const daemons: Daemon[] = [];
const dirs: string[] = [];

afterEach(() => {
  for (const d of daemons.splice(0)) {
    d.stop();
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("daemon", () => {
  test("two agents cannot hold the same path; RUN.md is written", async () => {
    const root = gitRepo();
    dirs.push(root);
    daemons.push(startDaemon({ repoRoot: root }));
    const start = await rpc(root, {
      id: "1",
      method: "start",
      params: { arch: "demo", branch: "dev" },
    });
    expect(start.ok).toBe(true);
    const a = await rpc(root, {
      id: "2",
      method: "acquire",
      params: { agent: "auth-1", path: "src/a.ts", doing: "rotate cookie", pid: process.pid },
    });
    expect(a.ok).toBe(true);
    const b = await rpc(root, {
      id: "3",
      method: "acquire",
      params: { agent: "ui-2", path: "src/a.ts", doing: "empty state", pid: process.pid },
    });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error).toBe("conflict");
    expect(existsSync(runMdPath(root))).toBe(true);
    const md = readFileSync(runMdPath(root), "utf8");
    expect(md).toContain("auth-1");
    expect(md).toContain("src/a.ts");
    expect(md).toContain("demo");
  });

  test("write_ok fails after a sibling changes the file", async () => {
    const root = gitRepo();
    dirs.push(root);
    daemons.push(startDaemon({ repoRoot: root }));
    await rpc(root, { id: "1", method: "start", params: { arch: "demo", branch: "dev" } });
    await rpc(root, {
      id: "2",
      method: "acquire",
      params: { agent: "auth-1", path: "src/a.ts", doing: "a", pid: process.pid },
    });
    writeFileSync(join(root, "src", "a.ts"), "changed\n");
    const ok = await rpc(root, {
      id: "3",
      method: "write_ok",
      params: { agent: "auth-1", path: "src/a.ts" },
    });
    expect(ok.ok).toBe(false);
    if (!ok.ok) expect(ok.error).toBe("drift");
  });
});
