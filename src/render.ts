import { mkdirSync } from "node:fs";
import type { ActorName, LiveRow, RpcOk } from "./rpc.ts";
import { modePath, runMdPath, wcpDir, writeRuntimeFile } from "./paths.ts";

function formatAge(sec: number): string {
  if (sec < 60) {
    return `${sec}s`;
  }
  return `${Math.floor(sec / 60)}m`;
}

function writeAge(row: LiveRow, now: string | undefined, ttlSec: number): string {
  if (!row.last_write_at || !now) {
    return row.expired ? "wrote ? | takeable" : "wrote ?";
  }
  const ageMs = Date.parse(now) - Date.parse(row.last_write_at);
  const shown = Number.isNaN(ageMs) || ageMs < 0 ? 0 : Math.floor(ageMs / 1000);
  const label = `wrote ${formatAge(shown)} ago`;
  if (row.expired) {
    return `${label} | takeable`;
  }
  const staleAt = ttlSec - 60;
  if (staleAt > 0 && shown >= staleAt) {
    return `${label} | stale`;
  }
  return label;
}

function liveLine(row: LiveRow, now: string | undefined, ttlSec: number): string {
  const from = row.from_agent ?? "-";
  const scope = row.scope ? `scope ${row.scope}` : "scope -";
  const test = row.test_path ? `test ${row.test_path}` : "test -";
  const flags = [row.drift ? "drift" : null].filter(Boolean).join(",");
  const flagBit = flags ? ` | ${flags}` : "";
  return `${row.agent_id} | ${row.path} | ${row.doing} | ${scope} | ${test} | from ${from} | ${row.leased_at} → ${row.expires_at} | ${writeAge(row, now, ttlSec)}${flagBit}`;
}

export function renderRunMd(look: {
  arch?: string;
  branch?: string;
  ttl_sec?: number;
  now?: string;
  live?: LiveRow[];
  names?: ActorName[];
}): string {
  const live = look.live ?? [];
  const names = look.names ?? [];
  const ttlSec = look.ttl_sec ?? 300;
  const lines = [
    "# Run",
    `branch: ${look.branch ?? "dev"}`,
    `arch: ${look.arch ?? ""}`,
    `ttl_sec: ${ttlSec}`,
    "",
    "## names",
  ];
  if (names.length === 0) {
    lines.push("(none)");
  } else {
    for (const named of names) {
      lines.push(named.agent_id);
    }
  }
  lines.push("", "## live");
  if (live.length === 0) {
    lines.push("(empty)");
  } else {
    for (const row of live) {
      lines.push(liveLine(row, look.now, ttlSec));
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function writeView(
  repoRoot: string,
  look: Pick<RpcOk, "arch" | "branch" | "ttl_sec" | "now" | "live" | "names">,
): void {
  mkdirSync(wcpDir(repoRoot), { recursive: true });
  writeRuntimeFile(runMdPath(repoRoot), renderRunMd(look));
  writeRuntimeFile(modePath(repoRoot), "referee\n");
}
