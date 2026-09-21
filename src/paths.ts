import { existsSync } from "node:fs";
import { join } from "node:path";

export function findRepoRoot(cwd: string = process.cwd()): string {
  const proc = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new Error("WCP requires a git checkout (git rev-parse --show-toplevel failed)");
  }
  return proc.stdout.toString().trim();
}

export function wcpDir(root: string): string {
  return join(root, ".WCP");
}

export function sockPath(root: string): string {
  return join(wcpDir(root), "wcp.sock");
}

export function dbPath(root: string): string {
  return join(wcpDir(root), "run.sqlite");
}

export function lockPath(root: string): string {
  return join(wcpDir(root), "wcpd.lock");
}

export function pidPath(root: string): string {
  return join(wcpDir(root), "wcpd.pid");
}

export function runMdPath(root: string): string {
  return join(wcpDir(root), "RUN.md");
}

export function modePath(root: string): string {
  return join(wcpDir(root), "mode");
}

export function barrelsPath(root: string): string {
  return join(wcpDir(root), "barrels");
}

export function wcpReady(root: string): boolean {
  return existsSync(wcpDir(root));
}
