import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureGitignore, installHooks, listWorktreeFiles, PRE_COMMIT_HOOK } from "../src/git.ts";
import { gitRepo } from "./helpers.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("gitignore and hooks", () => {
  test("ensureGitignore writes occupancy lines and drops a blanket .WCP/", () => {
    const root = gitRepo();
    dirs.push(root);
    writeFileSync(join(root, ".gitignore"), "node_modules/\n.WCP/\n");
    ensureGitignore(root);
    ensureGitignore(root);
    const lines = readFileSync(join(root, ".gitignore"), "utf8").split("\n");
    expect(lines.filter((line) => line === ".WCP/" || line === ".WCP")).toHaveLength(0);
    expect(lines.filter((line) => line === ".WCP/RUN.md")).toHaveLength(1);
    expect(lines.filter((line) => line === ".WCP/run.sqlite")).toHaveLength(1);
    expect(lines.filter((line) => line === ".WCP/*.sqlite-wal")).toHaveLength(1);
    expect(lines.filter((line) => line === ".WCP/*.sqlite-shm")).toHaveLength(1);
    expect(lines).toContain("node_modules/");
    const ignored = Bun.spawnSync(["git", "check-ignore", "-q", ".WCP/RUN.md"], { cwd: root });
    expect(ignored.exitCode).toBe(0);
    const tracked = Bun.spawnSync(["git", "check-ignore", "-q", ".WCP/issues/open/0123-rotate-refresh-token.md"], {
      cwd: root,
    });
    expect(tracked.exitCode).toBe(1);
  });

  test("pre-commit rejects staged occupancy and other non-issue .WCP paths", () => {
    const root = gitRepo();
    dirs.push(root);
    installHooks(root);
    mkdirSync(join(root, ".WCP"), { recursive: true });
    writeFileSync(join(root, ".WCP", "RUN.md"), "board\n");
    Bun.spawnSync(["git", "add", "-f", ".WCP/RUN.md"], { cwd: root });
    const commit = Bun.spawnSync(["git", "commit", "-m", "bad"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(commit.exitCode).not.toBe(0);
    expect(commit.stderr.toString() + commit.stdout.toString()).toContain(
      "only .WCP/issues/ is committed",
    );
  });

  test("pre-commit allows .WCP/issues", () => {
    const root = gitRepo();
    dirs.push(root);
    installHooks(root);
    const rel = ".WCP/issues/open/0123-rotate-refresh-token.md";
    mkdirSync(join(root, ".WCP", "issues", "open"), { recursive: true });
    writeFileSync(join(root, rel), "---\nid: 0123\nstatus: open\n---\n\nRotate.\n");
    const add = Bun.spawnSync(["git", "add", "--", rel], { cwd: root });
    expect(add.exitCode).toBe(0);
    const commit = Bun.spawnSync(["git", "commit", "-m", "queue"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(commit.exitCode).toBe(0);
  });

  test("installHooks replaces the old reject-all-.WCP hook", () => {
    const root = gitRepo();
    dirs.push(root);
    const hook = join(root, ".git", "hooks", "pre-commit");
    mkdirSync(join(root, ".git", "hooks"), { recursive: true });
    writeFileSync(
      hook,
      `#!/bin/sh
# WCP: do not commit .WCP/
if git diff --cached --name-only | grep -q '^\\.WCP/'; then
  echo "WCP: do not commit .WCP/" >&2
  exit 1
fi
exit 0
`,
    );
    installHooks(root);
    expect(readFileSync(hook, "utf8")).toBe(PRE_COMMIT_HOOK);
  });

  test("listWorktreeFiles includes tracked and new untracked files", () => {
    const root = gitRepo();
    dirs.push(root);
    writeFileSync(join(root, "src", "fresh.ts"), "x\n");
    const files = listWorktreeFiles(root);
    expect(files).toContain("src/a.ts");
    expect(files).toContain("src/fresh.ts");
    expect(files.some((file) => file.startsWith(".git/"))).toBe(false);
    mkdirSync(join(root, ".WCP", "issues", "open"), { recursive: true });
    writeFileSync(join(root, ".WCP", "issues", "open", "0123-rotate-refresh-token.md"), "x\n");
    ensureGitignore(root);
    const withIssue = listWorktreeFiles(root);
    expect(withIssue.some((file) => file.startsWith(".WCP/"))).toBe(false);
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
