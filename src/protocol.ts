import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, sep } from "node:path";

export const MISSING_SHA = "MISSING";
export const AGENT_ID_RE = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
export const DEFAULT_TTL_SEC = 60;

export function isoNow(d: Date = new Date()): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function addSecondsIso(iso: string, sec: number): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new Error(`invalid timestamp: ${iso}`);
  }
  return isoNow(new Date(ms + sec * 1000));
}

export function isExpired(expiresAt: string, now: string): boolean {
  return Date.parse(now) >= Date.parse(expiresAt);
}

export function validateAgentId(id: string): string {
  if (!AGENT_ID_RE.test(id)) {
    throw new Error(
      `agent id must match ${AGENT_ID_RE}: got ${JSON.stringify(id)}`,
    );
  }
  return id;
}

export function normalizeBoardPath(repoRoot: string, input: string): string {
  const root = normalize(repoRoot);
  const abs = isAbsolute(input) ? normalize(input) : normalize(join(root, input));
  let rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`path is outside the repo: ${input}`);
  }
  rel = rel.split(sep).join("/");
  if (rel.startsWith("./")) {
    rel = rel.slice(2);
  }
  if (!rel || rel === ".") {
    throw new Error(`path must be a file inside the repo: ${input}`);
  }
  return rel;
}

export function absFromBoard(repoRoot: string, boardPath: string): string {
  return join(repoRoot, ...boardPath.split("/"));
}

export function sha256File(absPath: string): string {
  if (!existsSync(absPath) || !statSync(absPath).isFile()) {
    return MISSING_SHA;
  }
  const hash = createHash("sha256");
  hash.update(readFileSync(absPath));
  return hash.digest("hex");
}

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const TEST_PATH_RE = [
  /(^|\/)[^/]+\.test\.(tsx?|jsx?|mjs|cjs|mts|cts)$/,
  /(^|\/)[^/]+\.spec\.(tsx?|jsx?|mjs|cjs|mts|cts)$/,
  /(^|\/)__tests__\//,
  /(^|\/)[^/]+_test\.(go|py|rs|rb|exs)$/,
  /(^|\/)test_[^/]+\.py$/,
  /(^|\/)[^/]+_spec\.rb$/,
  /(^|\/)[^/]+Tests?\.java$/,
  /(^|\/)[^/]+\.test\.cs$/,
];

export function isTestPath(boardPath: string): boolean {
  return TEST_PATH_RE.some((re) => re.test(boardPath));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function testMarksPath(text: string, agent: string, boardPath: string): boolean {
  const needle = `WCP ${agent}:`;
  const pathRe = new RegExp(
    `(?:^|[^A-Za-z0-9_./-])${escapeRegExp(boardPath)}(?![A-Za-z0-9_-])`,
  );
  for (const line of text.split(/\r?\n/)) {
    if (line.includes(needle) && pathRe.test(line)) {
      return true;
    }
  }
  return false;
}
