import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureGitignore, installHooks, listWorktreeFiles, PRE_COMMIT_HOOK, PRE_PUSH_HOOK } from "../src/git.ts";
import { usingLegacyWcpDir, wcpDirName } from "../src/paths.ts";
import { gitRepo } from "./helpers.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function git(root: string, args: string[]) {
  return Bun.spawnSync(["git", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
}

function commitFile(root: string, rel: string, body: string): { code: number; text: string } {
  mkdirSync(join(root, ...rel.split("/").slice(0, -1)), { recursive: true });
  writeFileSync(join(root, rel), body);
  git(root, ["config", "core.ignorecase", "false"]);
  const add = git(root, ["add", "-f", "--", rel]);
  if (add.exitCode !== 0) {
    return { code: add.exitCode ?? 1, text: add.stderr.toString() + add.stdout.toString() };
  }
  const commit = Bun.spawnSync(["git", "commit", "-m", "queue"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: commit.exitCode ?? 1,
    text: commit.stderr.toString() + commit.stdout.toString(),
  };
}

describe("gitignore and hooks", () => {
  test("ensureGitignore writes occupancy lines and drops a blanket .wcp/ or .WCP/", () => {
    const root = gitRepo();
    dirs.push(root);
    git(root, ["config", "core.ignorecase", "false"]);
    writeFileSync(join(root, ".gitignore"), "node_modules/\n.WCP/\n.wcp/\n");
    ensureGitignore(root);
    ensureGitignore(root);
    const lines = readFileSync(join(root, ".gitignore"), "utf8").split("\n");
    expect(lines.filter((line) => line === ".WCP/" || line === ".WCP" || line === ".wcp/" || line === ".wcp")).toHaveLength(0);
    expect(lines.filter((line) => line === ".wcp/RUN.md")).toHaveLength(1);
    expect(lines.filter((line) => line === ".wcp/run.sqlite")).toHaveLength(1);
    expect(lines.filter((line) => line === ".wcp/*.sqlite-wal")).toHaveLength(1);
    expect(lines.filter((line) => line === ".wcp/*.sqlite-shm")).toHaveLength(1);
    expect(lines.filter((line) => line === ".WCP/RUN.md")).toHaveLength(0);
    expect(lines).toContain("node_modules/");
    expect(git(root, ["check-ignore", "-q", ".wcp/RUN.md"]).exitCode).toBe(0);
    expect(git(root, ["check-ignore", "-q", ".wcp/issues/open/0123-rotate-refresh-token.md"]).exitCode).toBe(1);
  });

  test("ensureGitignore also ignores legacy occupancy while .WCP is the queue folder", () => {
    const root = gitRepo();
    dirs.push(root);
    git(root, ["config", "core.ignorecase", "false"]);
    mkdirSync(join(root, ".WCP"));
    expect(wcpDirName(root)).toBe(".WCP");
    expect(usingLegacyWcpDir(root)).toBe(true);
    expect(readdirSync(root)).toContain(".WCP");
    expect(readdirSync(root)).not.toContain(".wcp");
    writeFileSync(join(root, ".gitignore"), "node_modules/\n.WCP/\n");
    ensureGitignore(root);
    const lines = readFileSync(join(root, ".gitignore"), "utf8").split("\n");
    expect(lines).toContain(".wcp/RUN.md");
    expect(lines).toContain(".WCP/RUN.md");
    expect(lines).toContain(".WCP/run.sqlite");
    expect(lines).toContain(".WCP/*.sqlite-wal");
    expect(lines).toContain(".WCP/*.sqlite-shm");
    expect(lines.filter((line) => line === ".WCP/" || line === ".WCP")).toHaveLength(0);
    expect(lines).toContain("node_modules/");
    expect(git(root, ["check-ignore", "-q", ".WCP/RUN.md"]).exitCode).toBe(0);
    expect(git(root, ["check-ignore", "-q", ".WCP/issues/open/0123-rotate-refresh-token.md"]).exitCode).toBe(1);
  });

  test("wcpDirName uses .wcp when that directory entry exists", () => {
    const root = gitRepo();
    dirs.push(root);
    mkdirSync(join(root, ".wcp"));
    expect(wcpDirName(root)).toBe(".wcp");
    expect(usingLegacyWcpDir(root)).toBe(false);
  });

  test("pre-commit rejects staged occupancy outside issues for both spellings", () => {
    for (const dirName of [".wcp", ".WCP"] as const) {
      const root = gitRepo();
      dirs.push(root);
      installHooks(root);
      const result = commitFile(root, `${dirName}/RUN.md`, "board\n");
      expect(result.code).not.toBe(0);
      expect(result.text).toContain("only .wcp/issues/ is committed");
    }
  });

  test("pre-commit allows issues under both spellings", () => {
    for (const dirName of [".wcp", ".WCP"] as const) {
      const root = gitRepo();
      dirs.push(root);
      installHooks(root);
      const rel = `${dirName}/issues/open/0123-rotate-refresh-token.md`;
      const result = commitFile(root, rel, "---\nid: 0123\nstatus: open\n---\n\nRotate.\n");
      expect(result.code).toBe(0);
    }
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

  test("installHooks replaces the issues-only .WCP hook", () => {
    const root = gitRepo();
    dirs.push(root);
    const hook = join(root, ".git", "hooks", "pre-commit");
    mkdirSync(join(root, ".git", "hooks"), { recursive: true });
    writeFileSync(
      hook,
      `#!/bin/sh
# WCP: commit .WCP/issues/ only
if git diff --cached --name-only | grep '^\\.WCP/' | grep -v '^\\.WCP/issues/' | grep -q .; then
  echo "WCP: do not commit the board or sqlite; only .WCP/issues/ is committed" >&2
  exit 1
fi
exit 0
`,
    );
    installHooks(root);
    expect(readFileSync(hook, "utf8")).toBe(PRE_COMMIT_HOOK);
  });

  test("checked-in hooks match the hook templates", () => {
    expect(readFileSync(join(import.meta.dir, "../hooks/pre-commit"), "utf8")).toBe(PRE_COMMIT_HOOK);
    expect(readFileSync(join(import.meta.dir, "../hooks/pre-push"), "utf8")).toBe(PRE_PUSH_HOOK);
  });

  test("listWorktreeFiles includes tracked and new untracked files", () => {
    const root = gitRepo();
    dirs.push(root);
    writeFileSync(join(root, "src", "fresh.ts"), "x\n");
    const files = listWorktreeFiles(root);
    expect(files).toContain("src/a.ts");
    expect(files).toContain("src/fresh.ts");
    expect(files.some((file) => file.startsWith(".git/"))).toBe(false);
    mkdirSync(join(root, ".wcp", "issues", "open"), { recursive: true });
    writeFileSync(join(root, ".wcp", "issues", "open", "0123-rotate-refresh-token.md"), "x\n");
    ensureGitignore(root);
    const withIssue = listWorktreeFiles(root);
    expect(withIssue.some((file) => file.startsWith(".wcp/") || file.startsWith(".WCP/"))).toBe(false);
  });

  test("listWorktreeFiles skips a legacy .WCP queue", () => {
    const root = gitRepo();
    dirs.push(root);
    mkdirSync(join(root, ".WCP", "issues", "open"), { recursive: true });
    writeFileSync(join(root, ".WCP", "issues", "open", "0123-rotate-refresh-token.md"), "x\n");
    const files = listWorktreeFiles(root);
    expect(files.some((file) => file.startsWith(".WCP/") || file.startsWith(".wcp/"))).toBe(false);
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

  test("pre-push rejects staged runtime outside issues", () => {
    const root = gitRepo();
    dirs.push(root);
    installHooks(root);
    mkdirSync(join(root, ".WCP"), { recursive: true });
    writeFileSync(join(root, ".WCP", "barrels"), "lock\n");
    git(root, ["add", "-f", "--", ".WCP/barrels"]);
    const hook = Bun.spawnSync(["sh", join(root, ".git", "hooks", "pre-push")], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(hook.exitCode).toBe(1);
    expect(hook.stderr.toString()).toContain("only .wcp/issues/ is committed");
  });
});
