import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Canonical queue folder. */
export const WCP_DIR_NAME = ".wcp";
/** Pre-lowercase folder. Used only when it is the sole queue directory. */
export const LEGACY_WCP_DIR_NAME = ".WCP";

export const MIGRATE_COMMAND = "git mv .WCP .wcp-tmp && git mv .wcp-tmp .wcp";
/** Git refuses `git mv` when the legacy folder has no tracked files. */
export const MIGRATE_RUNTIME_COMMAND = "mv .WCP .wcp-tmp && mv .wcp-tmp .wcp";

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

export type WcpDirEntries = { canonical: boolean; legacy: boolean };

/** Both folders exist. The one-folder rename nests a tree, so it is not the fix. */
export const DUAL_DIR_LINE =
  "WCP refuses to run while both .wcp/ and .WCP/ exist. Stop any daemon. Do not rename one folder onto the other; that nests a tree. Copy issue files from .WCP/issues/ into .wcp/issues/ only when the destination file is missing, keep the runtime database you still need, then remove .WCP/ after checking the copy.";

/** Pick the queue folder. Both spellings at once is a second daemon, so refuse. */
export function wcpDirNameFrom(entries: WcpDirEntries): string {
  if (entries.canonical && entries.legacy) {
    throw new Error(DUAL_DIR_LINE);
  }
  if (entries.canonical) {
    return WCP_DIR_NAME;
  }
  if (entries.legacy) {
    return LEGACY_WCP_DIR_NAME;
  }
  return WCP_DIR_NAME;
}

export function wcpDirName(root: string): string {
  return wcpDirNameFrom(wcpDirNames(root));
}

export function usingLegacyWcpDir(root: string): boolean {
  const { canonical, legacy } = wcpDirNames(root);
  return legacy && !canonical;
}

export function wcpDir(root: string): string {
  const dir = join(root, wcpDirName(root));
  if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) {
    throw new Error(`WCP refuses a symlink at ${dir}`);
  }
  return dir;
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
  return `WCP: this checkout still uses .WCP/. If Git tracks the folder: ${MIGRATE_COMMAND}. If it is runtime only: ${MIGRATE_RUNTIME_COMMAND}`;
}

/** Doctor text for one checkout. Dual directories exit non-zero and do not choose a folder. */
export function doctorReport(entries: WcpDirEntries): { code: number; lines: string[] } {
  if (entries.canonical && entries.legacy) {
    return {
      code: 1,
      lines: ["wcp: both .wcp/ and .WCP/ exist. WCP will not choose one.", DUAL_DIR_LINE],
    };
  }
  const state = entries.canonical ? "canonical" : entries.legacy ? "legacy" : "absent";
  const label = entries.canonical || !entries.legacy ? ".wcp" : ".WCP";
  const lines = [`wcp: directory ${label} (${state})`];
  if (entries.legacy && !entries.canonical) {
    lines.push(legacyMigrationLine());
  }
  return { code: 0, lines };
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
