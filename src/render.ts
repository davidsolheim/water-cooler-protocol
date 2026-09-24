import { mkdirSync, writeFileSync } from "node:fs";
import type { ActorName, LiveRow, RpcOk } from "./rpc.ts";
import { modePath, runMdPath, wcpDir } from "./paths.ts";

function liveLine(row: LiveRow): string {
  const from = row.from_agent ?? "-";
  const scope = row.scope ? `scope ${row.scope}` : "scope -";
  const test = row.test_path ? `test ${row.test_path}` : "test -";
  const flags = [row.expired ? "expired" : null, row.drift ? "drift" : null]
    .filter(Boolean)
    .join(",");
  const flagBit = flags ? ` | ${flags}` : "";
  return `${row.agent_id} | ${row.path} | ${row.doing} | ${scope} | ${test} | from ${from} | ${row.leased_at} → ${row.expires_at}${flagBit}`;
}

export function renderRunMd(look: {
  arch?: string;
  branch?: string;
  ttl_sec?: number;
  live?: LiveRow[];
  names?: ActorName[];
}): string {
  const live = look.live ?? [];
  const names = look.names ?? [];
  const lines = [
    "# Run",
    `branch: ${look.branch ?? "dev"}`,
    `arch: ${look.arch ?? ""}`,
    `ttl_sec: ${look.ttl_sec ?? 60}`,
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
      lines.push(liveLine(row));
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function writeView(
  repoRoot: string,
  look: Pick<RpcOk, "arch" | "branch" | "ttl_sec" | "live" | "names">,
): void {
  mkdirSync(wcpDir(repoRoot), { recursive: true });
  writeFileSync(runMdPath(repoRoot), renderRunMd(look));
  writeFileSync(modePath(repoRoot), "referee\n");
}
