import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { barrelsPath } from "./paths.ts";

export const DEFAULT_BARRELS = `package-lock.json
pnpm-lock.yaml
bun.lock
bun.lockb
yarn.lock
**/generated/**
**/*.gen.ts
**/schema.prisma
`;

/** Occupancy only. `.WCP/issues/` stays tracked. */
export const OCCUPANCY_GITIGNORE = [
  ".WCP/RUN.md",
  ".WCP/run.sqlite",
  ".WCP/*.sqlite-wal",
  ".WCP/*.sqlite-shm",
] as const;

export const PRE_COMMIT_HOOK = `#!/bin/sh
# WCP: commit .WCP/issues/ only
if git diff --cached --name-only | grep '^\\.WCP/' | grep -v '^\\.WCP/issues/' | grep -q .; then
  echo "WCP: do not commit the board or sqlite; only .WCP/issues/ is committed" >&2
  exit 1
fi
exit 0
`;

export const PRE_PUSH_HOOK = `#!/bin/sh
# WCP: agents do not push
if [ -n "$WCP_AGENT" ]; then
  echo "WCP: agents do not push; drop WCP_AGENT if you are the human." >&2
  exit 1
fi
if git diff --cached --name-only 2>/dev/null | grep '^\\.WCP/' | grep -v '^\\.WCP/issues/' | grep -q .; then
  echo "WCP: do not push the board or sqlite; only .WCP/issues/ is committed" >&2
  exit 1
fi
exit 0
`;

const PREVIOUS_PRE_COMMIT_HOOK = `#!/bin/sh
# WCP: do not commit .WCP/
if git diff --cached --name-only | grep -q '^\\.WCP/'; then
  echo "WCP: do not commit .WCP/" >&2
  exit 1
fi
exit 0
`;

const PREVIOUS_PRE_PUSH_HOOK = `#!/bin/sh
# WCP: agents do not push
if [ -n "$WCP_AGENT" ]; then
  echo "WCP: agents do not push; drop WCP_AGENT if you are the human." >&2
  exit 1
fi
if git diff --cached --name-only 2>/dev/null | grep -q '^\\.WCP/'; then
  echo "WCP: do not push .WCP/" >&2
  exit 1
fi
exit 0
`;

function gitZ(repoRoot: string, args: string[]): string[] {
  const proc = Bun.spawnSync(["git", ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed`);
  }
  return proc.stdout.toString().split("\0").filter(Boolean);
}

export function listWorktreeFiles(repoRoot: string): string[] {
  const tracked = gitZ(repoRoot, ["ls-files", "-z"]);
  const untracked = gitZ(repoRoot, ["ls-files", "-z", "--others", "--exclude-standard"]);
  const seen = new Set<string>();
  for (const raw of [...tracked, ...untracked]) {
    const rel = raw.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!rel || rel.startsWith("/") || rel.startsWith(".WCP/") || rel.split("/").includes("..")) {
      continue;
    }
    seen.add(rel);
  }
  return [...seen].sort();
}

export function gitBranch(repoRoot: string): string {
  const proc = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new Error("could not read git branch");
  }
  return proc.stdout.toString().trim();
}

export function ensureGitignore(repoRoot: string): void {
  const path = join(repoRoot, ".gitignore");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = existing.split("\n");
  const filtered = lines.filter((line) => line !== ".WCP/" && line !== ".WCP");
  const present = new Set(filtered);
  const missing = OCCUPANCY_GITIGNORE.filter((line) => !present.has(line));
  const removedBlanket = filtered.length !== lines.length;
  if (existsSync(path) && !removedBlanket && missing.length === 0) {
    return;
  }
  let body = filtered.join("\n");
  if (body.length > 0 && !body.endsWith("\n")) {
    body += "\n";
  }
  if (missing.length > 0) {
    body += `${missing.join("\n")}\n`;
  }
  writeFileSync(path, body);
}

export function ensureBarrels(repoRoot: string): void {
  if (!existsSync(barrelsPath(repoRoot))) {
    writeFileSync(barrelsPath(repoRoot), DEFAULT_BARRELS);
  }
}

function sameHook(a: string, b: string): boolean {
  return a.replace(/\s+$/, "") === b.replace(/\s+$/, "");
}

function writeHook(path: string, body: string, previous: string): void {
  const mark = "# existing hook follows\n";
  if (!existsSync(path)) {
    writeFileSync(path, body);
    chmodSync(path, 0o755);
    return;
  }
  const cur = readFileSync(path, "utf8");
  if (sameHook(cur, body)) {
    chmodSync(path, 0o755);
    return;
  }
  if (sameHook(cur, previous)) {
    writeFileSync(path, body);
    chmodSync(path, 0o755);
    return;
  }
  const at = cur.indexOf(mark);
  if (at !== -1 && cur.slice(0, at).includes("WCP:")) {
    writeFileSync(path, `${body}\n${mark}${cur.slice(at + mark.length)}`);
    chmodSync(path, 0o755);
    return;
  }
  if (cur.includes("WCP:")) {
    return;
  }
  writeFileSync(path, `${body}\n${mark}${cur}`);
  chmodSync(path, 0o755);
}

export function installHooks(repoRoot: string): void {
  const dir = join(repoRoot, ".git", "hooks");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeHook(join(dir, "pre-commit"), PRE_COMMIT_HOOK, PREVIOUS_PRE_COMMIT_HOOK);
  writeHook(join(dir, "pre-push"), PRE_PUSH_HOOK, PREVIOUS_PRE_PUSH_HOOK);
}
