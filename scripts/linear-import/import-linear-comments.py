#!/usr/bin/env python3
"""Append Linear comments onto imported WCP issues. Does not print secrets."""

from __future__ import annotations

import argparse
import json
import sys
import tomllib
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from wcp_paths import (
    QUEUE_FOLDERS,
    issues_root,
    parse_linear_id,
    parse_queue_folders,
    require_linear_identifier,
    resolve_under_issues,
)

API = "https://api.linear.app/graphql"
COMMENTS_BATCH_SIZE = 50
COMMENTS_BATCH_QUERY = """
query($ids: [String!]!, $cursor: String) {
  issues(
    first: 50
    after: $cursor
    includeArchived: true
    filter: { identifier: { in: $ids } }
  ) {
    pageInfo { hasNextPage endCursor }
    nodes {
      identifier
      comments(first: 50) {
        pageInfo { hasNextPage }
        nodes { body createdAt user { name } }
      }
    }
  }
}
"""


def load_token(config_path: Path, server: str) -> str:
    with config_path.open("rb") as handle:
        cfg = tomllib.load(handle)
    servers = cfg.get("mcp_servers") or {}
    if server not in servers:
        known = ", ".join(sorted(servers))
        raise SystemExit(f"MCP server {server!r} is not in {config_path}. Known: {known}")
    headers = (servers.get(server) or {}).get("headers") or {}
    raw = ""
    for key, value in headers.items():
        if str(key).lower() == "authorization":
            raw = str(value).strip()
            break
    if not raw:
        raise SystemExit(f"MCP server {server!r} has no Authorization header")
    if raw.lower().startswith("bearer "):
        raw = raw.split(" ", 1)[1].strip()
    if not raw:
        raise SystemExit(f"MCP server {server!r} has an empty Authorization header")
    return raw


def comments_batch_payload(ids: list[str], cursor: str | None = None) -> dict:
    return {
        "query": COMMENTS_BATCH_QUERY,
        "variables": {"ids": list(ids), "cursor": cursor},
    }


def chunk_identifiers(ids: list[str], size: int = COMMENTS_BATCH_SIZE) -> list[list[str]]:
    if size < 1:
        raise ValueError("batch size must be >= 1")
    return [list(ids[i : i + size]) for i in range(0, len(ids), size)]


def graphql(token: str, payload: dict) -> dict:
    req = urllib.request.Request(
        API,
        data=json.dumps(payload).encode(),
        headers={"Authorization": token, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Linear HTTP {exc.code}") from None
    if body.get("errors"):
        messages = [err.get("message", "graphql error") for err in body["errors"]]
        raise RuntimeError("Linear query failed: " + "; ".join(messages))
    return body.get("data") or {}


def fetch_comments_for_ids(token: str, ids: list[str]) -> dict[str, dict]:
    found: dict[str, dict] = {}
    cursor = None
    while True:
        page = (graphql(token, comments_batch_payload(ids, cursor)).get("issues") or {})
        for node in page.get("nodes") or []:
            ident = node.get("identifier")
            if ident:
                found[ident] = node["comments"]
        page_info = page.get("pageInfo") or {}
        if not page_info.get("hasNextPage"):
            break
        cursor = page_info.get("endCursor")
        if not cursor:
            break
    missing = [ident for ident in ids if ident not in found]
    if missing:
        raise RuntimeError("Linear comments missing for " + ", ".join(missing))
    return found


def comment_block(identifier: str, comments: dict) -> tuple[str, int, bool]:
    nodes = comments["nodes"]
    lines = ["", "## Linear comments", ""]
    if not nodes:
        lines.append("_No Linear comments._")
    else:
        for node in nodes:
            who = ((node.get("user") or {}).get("name") or "Someone").strip()
            when = node.get("createdAt") or ""
            body = (node.get("body") or "").strip() or "_Empty comment._"
            lines.append(f"### {who} — {when}")
            lines.append("")
            lines.append(body)
            lines.append("")
    truncated = bool(comments["pageInfo"]["hasNextPage"])
    if truncated:
        lines.append("_Older comments exist in Linear beyond the 50 copied here._")
    lines.append("")
    return "\n".join(lines), len(nodes), truncated


def identifier_from_issue(path: Path, text: str) -> str:
    if len(text.split("---", 2)) < 3:
        raise ValueError(f"missing frontmatter in {path.name}")
    ident = parse_linear_id(text)
    if not ident:
        raise ValueError(f"missing linear_id in {path.name}")
    return require_linear_identifier(ident)


def collect_pending(root: Path, folders: list[str]) -> list[tuple[Path, str]]:
    pending: list[tuple[Path, str]] = []
    for folder in folders:
        for path in sorted((root / folder).glob("*.md")):
            resolved = resolve_under_issues(root, path)
            text = resolved.read_text(encoding="utf-8")
            if "\n## Linear comments\n" in text:
                continue
            pending.append((resolved, identifier_from_issue(resolved, text)))
    return pending


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--server", required=True)
    parser.add_argument("--config", type=Path, default=Path.home() / ".grok" / "config.toml")
    parser.add_argument(
        "--folders",
        default=",".join(QUEUE_FOLDERS),
        help="Comma-separated queue folders. Only open, in-progress, in-review, done, canceled, blocked",
    )
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--dry-run", action="store_true", help="Count files that still need comments")
    args = parser.parse_args()

    try:
        folders = parse_queue_folders(args.folders)
    except ValueError as exc:
        raise SystemExit(str(exc)) from None
    root = issues_root(args.repo)
    try:
        pending = collect_pending(root, folders)
    except ValueError as exc:
        raise SystemExit(str(exc)) from None
    print(json.dumps({"pending": len(pending), "folders": folders}))
    if args.dry_run or not pending:
        return

    token = load_token(args.config, args.server)
    written = 0
    empty = 0
    truncated = 0
    errors: list[str] = []
    unique_ids: list[str] = []
    seen: set[str] = set()
    for _path, ident in pending:
        if ident not in seen:
            unique_ids.append(ident)
            seen.add(ident)
    comments_by_id: dict[str, dict] = {}

    def load_chunk(chunk: list[str]) -> dict[str, dict]:
        return fetch_comments_for_ids(token, chunk)

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        chunks = chunk_identifiers(unique_ids)
        futures = {pool.submit(load_chunk, chunk): chunk for chunk in chunks}
        for future in as_completed(futures):
            chunk = futures[future]
            try:
                comments_by_id.update(future.result())
            except Exception as exc:  # noqa: BLE001 — surface identifiers, never the token
                label = chunk[0] if len(chunk) == 1 else f"{chunk[0]}..{chunk[-1]}"
                errors.append(f"batch {label}: {exc}")
                print(f"FAILED batch {label}", flush=True)

    for path, ident in pending:
        comments = comments_by_id.get(ident)
        if comments is None:
            errors.append(f"{path.name}: comments not fetched for {ident}")
            print(f"FAILED {path.name}", flush=True)
            continue
        try:
            text = path.read_text(encoding="utf-8")
            block, count, was_truncated = comment_block(ident, comments)
            path.write_text(text.rstrip() + "\n" + block, encoding="utf-8")
        except Exception as exc:  # noqa: BLE001 — surface the identifier, never the token
            errors.append(f"{path.name}: {exc}")
            print(f"FAILED {path.name}", flush=True)
            continue
        written += 1
        if count == 0:
            empty += 1
        if was_truncated:
            truncated += 1
        print(f"{path.name} comments={count}", flush=True)

    del token
    print(json.dumps({"written": written, "empty": empty, "truncated": truncated, "failed": len(errors)}))
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
