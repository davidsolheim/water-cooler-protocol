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

export const PRE_COMMIT_HOOK = `#!/bin/sh
# WCP: do not commit .WCP/
if git diff --cached --name-only | grep -q '^\\.WCP/'; then
  echo "WCP: do not commit .WCP/" >&2
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
if git diff --cached --name-only 2>/dev/null | grep -q '^\\.WCP/'; then
  echo "WCP: do not push .WCP/" >&2
  exit 1
fi
exit 0
`;

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
  if (/(^|\n)\.WCP\/(\n|$)/.test(existing)) {
    return;
  }
  const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  writeFileSync(path, `${existing}${prefix}.WCP/\n`);
}

export function ensureBarrels(repoRoot: string): void {
  if (!existsSync(barrelsPath(repoRoot))) {
    writeFileSync(barrelsPath(repoRoot), DEFAULT_BARRELS);
  }
}

function writeHook(path: string, body: string): void {
  if (existsSync(path)) {
    const cur = readFileSync(path, "utf8");
    if (cur.includes("WCP:")) {
      return;
    }
    writeFileSync(path, `${body}\n# existing hook follows\n${cur}`);
  } else {
    writeFileSync(path, body);
  }
  chmodSync(path, 0o755);
}

export function installHooks(repoRoot: string): void {
  const dir = join(repoRoot, ".git", "hooks");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeHook(join(dir, "pre-commit"), PRE_COMMIT_HOOK);
  writeHook(join(dir, "pre-push"), PRE_PUSH_HOOK);
}
