import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Canonical queue folder. */
export const WCP_DIR_NAME = ".wcp";
/** Pre-lowercase folder. Used only when it is the sole queue directory. */
export const LEGACY_WCP_DIR_NAME = ".WCP";

export const MIGRATE_COMMAND = "git mv .WCP .wcp-tmp && git mv .wcp-tmp .wcp";

function dirNames(root: string): string[] {
  try {
    return readdirSync(root);
  } catch {
    return [];
  }
}

/** Exact directory-entry spellings. `existsSync` is not enough on a case-insensitive volume. */
export function wcpDirNames(root: string): { canonical: boolean; legacy: boolean } {
  const names = dirNames(root);
  return {
    canonical: names.includes(WCP_DIR_NAME),
    legacy: names.includes(LEGACY_WCP_DIR_NAME),
  };
}

export function wcpDirName(root: string): string {
  const { canonical, legacy } = wcpDirNames(root);
  if (canonical) {
    return WCP_DIR_NAME;
  }
  if (legacy) {
    return LEGACY_WCP_DIR_NAME;
  }
  return WCP_DIR_NAME;
}

export function usingLegacyWcpDir(root: string): boolean {
  const { canonical, legacy } = wcpDirNames(root);
  return legacy && !canonical;
}

export function wcpDir(root: string): string {
  return join(root, wcpDirName(root));
}

export function isWcpTreePath(rel: string): boolean {
  return (
    rel === WCP_DIR_NAME ||
    rel.startsWith(`${WCP_DIR_NAME}/`) ||
    rel === LEGACY_WCP_DIR_NAME ||
    rel.startsWith(`${LEGACY_WCP_DIR_NAME}/`)
  );
}

export function legacyMigrationLine(): string {
  return `WCP: this checkout still uses .WCP/. Migrate with: ${MIGRATE_COMMAND}`;
}

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
