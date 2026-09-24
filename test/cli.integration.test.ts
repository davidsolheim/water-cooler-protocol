import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
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
  test("name reserves an id and rejects a second claim on it", () => {
    const root = gitRepo();
    dirs.push(root);
    expect(wcp(root, ["init", "--arch", "demo", "--json"]).code).toBe(0);
    const named = wcp(root, ["name", "session-refresh", "--json"]);
    expect(named.code).toBe(0);
    const body = JSON.parse(named.out) as { ok: boolean; agent: string; token: string };
    expect(body.agent).toBe("session-refresh");
    expect(body.token.length).toBeGreaterThan(8);
    const again = wcp(root, ["name", "session-refresh", "--json"], {
      WCP_AGENT: "session-refresh",
      WCP_NAME_TOKEN: body.token,
    });
    expect(again.code).toBe(0);
    expect(JSON.parse(again.out).token).toBe(body.token);
    const taken = wcp(root, ["name", "session-refresh", "--json"]);
    expect(taken.code).toBe(1);
    expect(JSON.parse(taken.out).error).toBe("name_taken");
    const stuck = wcp(root, ["name", "other-name", "--json"], {
      WCP_AGENT: "session-refresh",
      WCP_NAME_TOKEN: body.token,
    });
    expect(stuck.code).toBe(1);
    expect(JSON.parse(stuck.out).error).toBe("already_named");
  });

  test("init, exclusive acquire, write-ok, stop", () => {
    const root = gitRepo();
    dirs.push(root);
    const init = wcp(root, ["init", "--arch", "demo", "--json"]);
    expect(init.code).toBe(0);
    const started = JSON.parse(init.out);
    expect(started.ok).toBe(true);
    expect(started.arch).toBe("demo");
    const gi = readFileSync(join(root, ".gitignore"), "utf8").split("\n");
    expect(gi).toContain(".WCP/RUN.md");
    expect(gi).toContain(".WCP/run.sqlite");
    expect(gi.filter((line) => line === ".WCP/" || line === ".WCP")).toHaveLength(0);
    expect(readFileSync(join(root, ".WCP", "mode"), "utf8").trim()).toBe("referee");

    writeFileSync(
      join(root, "src", "a.test.ts"),
      "// WCP auth-1: src/a.ts rotate cookie (demo)\n// WCP ui-2: src/a.ts empty state (demo)\n",
    );
    const a = wcp(
      root,
      ["acquire", "--path", "src/a.ts", "--test", "src/a.test.ts", "--doing", "rotate cookie", "--json"],
      { WCP_AGENT: "auth-1" },
    );
    expect(a.code).toBe(0);
    expect(JSON.parse(a.out).ok).toBe(true);

    const fresh = wcp(root, ["write-ok", "--path", "src/fresh.ts", "--json"], { WCP_AGENT: "auth-1" });
    expect(fresh.code).toBe(0);
    expect(JSON.parse(fresh.out).claim).toBe("new_file");

    const b = wcp(
      root,
      ["acquire", "--path", "src/a.ts", "--test", "src/a.test.ts", "--doing", "empty state", "--json"],
      { WCP_AGENT: "ui-2" },
    );
    expect(b.code).toBe(1);
    expect(JSON.parse(b.out).error).toBe("conflict");

    const ok = wcp(root, ["write-ok", "--path", "src/a.ts", "--json"], { WCP_AGENT: "auth-1" });
    expect(ok.code).toBe(0);

    const stop = wcp(root, ["stop", "--json"]);
    expect(stop.code).toBe(0);
  });
});
