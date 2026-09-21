import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
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

function wcp(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { code: number; out: string; err: string } {
  const proc = Bun.spawnSync([process.execPath, cli, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  return {
    code: proc.exitCode ?? 1,
    out: proc.stdout.toString(),
    err: proc.stderr.toString(),
  };
}

describe("cli", () => {
  test("init, exclusive acquire, write-ok, stop", () => {
    const root = gitRepo();
    dirs.push(root);
    const init = wcp(root, ["init", "--arch", "demo", "--json"]);
    expect(init.code).toBe(0);
    const started = JSON.parse(init.out);
    expect(started.ok).toBe(true);
    expect(started.arch).toBe("demo");
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain(".WCP/");
    expect(readFileSync(join(root, ".WCP", "mode"), "utf8").trim()).toBe("referee");

    const a = wcp(root, ["acquire", "--path", "src/a.ts", "--doing", "rotate cookie", "--json"], {
      WCP_AGENT: "auth-1",
    });
    expect(a.code).toBe(0);
    expect(JSON.parse(a.out).ok).toBe(true);

    const b = wcp(root, ["acquire", "--path", "src/a.ts", "--doing", "empty state", "--json"], {
      WCP_AGENT: "ui-2",
    });
    expect(b.code).toBe(1);
    expect(JSON.parse(b.out).error).toBe("conflict");

    const ok = wcp(root, ["write-ok", "--path", "src/a.ts", "--json"], { WCP_AGENT: "auth-1" });
    expect(ok.code).toBe(0);

    const stop = wcp(root, ["stop", "--json"]);
    expect(stop.code).toBe(0);
  });
});
