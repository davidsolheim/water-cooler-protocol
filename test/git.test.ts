import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureGitignore, installHooks } from "../src/git.ts";
import { gitRepo } from "./helpers.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("gitignore and hooks", () => {
  test("ensureGitignore appends .WCP/", () => {
    const root = gitRepo();
    dirs.push(root);
    ensureGitignore(root);
    ensureGitignore(root);
    const gi = readFileSync(join(root, ".gitignore"), "utf8");
    expect(gi.split("\n").filter((l) => l === ".WCP/")).toHaveLength(1);
  });

  test("pre-commit rejects staged .WCP paths", () => {
    const root = gitRepo();
    dirs.push(root);
    installHooks(root);
    mkdirSync(join(root, ".WCP"), { recursive: true });
    writeFileSync(join(root, ".WCP", "secret.txt"), "nope");
    Bun.spawnSync(["git", "add", "-f", ".WCP/secret.txt"], { cwd: root });
    const commit = Bun.spawnSync(["git", "commit", "-m", "bad"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(commit.exitCode).not.toBe(0);
    expect(commit.stderr.toString() + commit.stdout.toString()).toContain("do not commit .WCP");
  });

  test("pre-push rejects WCP_AGENT", () => {
    const root = gitRepo();
    dirs.push(root);
    installHooks(root);
    const hook = Bun.spawnSync(["sh", join(root, ".git", "hooks", "pre-push")], {
      cwd: root,
      env: { ...process.env, WCP_AGENT: "ui-2" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(hook.exitCode).toBe(1);
    expect(hook.stderr.toString()).toContain("agents do not push");
  });
});
