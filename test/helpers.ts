import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function tempDir(prefix = "wcp-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function gitRepo(): string {
  const dir = tempDir("wcp-git-");
  const git = (args: string[]) => {
    const proc = Bun.spawnSync(["git", ...args], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode !== 0) {
      throw new Error(`git ${args.join(" ")}: ${proc.stderr.toString()}`);
    }
  };
  git(["init"]);
  git(["config", "user.email", "wcp@test"]);
  git(["config", "user.name", "wcp"]);
  git(["checkout", "-b", "dev"]);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "a.ts"), "one\n");
  git(["add", "src/a.ts"]);
  git(["commit", "-m", "init"]);
  return dir;
}
