#!/usr/bin/env python3
"""Append Linear comments onto imported WCP issues. Does not print secrets."""

from __future__ import annotations

import argparse
import json
import re
import sys
import tomllib
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

API = "https://api.linear.app/graphql"
FOLDERS = ("open", "in-progress", "in-review", "done", "canceled", "blocked")
QUERY = """
query($id: String!) {
  issue(id: $id) {
    comments(first: 50) {
      pageInfo { hasNextPage }
      nodes { body createdAt user { name } }
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


def graphql(token: str, identifier: str) -> dict:
    payload = json.dumps({"query": QUERY, "variables": {"id": identifier}}).encode()
    req = urllib.request.Request(
        API,
        data=payload,
        headers={"Authorization": token, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"{identifier}: Linear HTTP {exc.code}") from None
    if body.get("errors"):
        messages = [err.get("message", "graphql error") for err in body["errors"]]
        raise RuntimeError(identifier + ": " + "; ".join(messages))
    issue = body.get("data", {}).get("issue")
    if not issue:
        raise RuntimeError(f"{identifier}: Linear issue not found")
    return issue["comments"]


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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--server", required=True)
    parser.add_argument("--config", type=Path, default=Path.home() / ".grok" / "config.toml")
    parser.add_argument(
        "--folders",
        default=",".join(FOLDERS),
        help="Comma-separated queue folders. Default: every status folder",
    )
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--dry-run", action="store_true", help="Count files that still need comments")
    args = parser.parse_args()

    folders = [part.strip() for part in args.folders.split(",") if part.strip()]
    root = args.repo / ".WCP" / "issues"
    pending: list[Path] = []
    for folder in folders:
        for path in sorted((root / folder).glob("*.md")):
            text = path.read_text(encoding="utf-8")
            if "\n## Linear comments\n" in text:
                continue
            pending.append(path)
    print(json.dumps({"pending": len(pending), "folders": folders}))
    if args.dry_run or not pending:
        return

    token = load_token(args.config, args.server)
    written = 0
    empty = 0
    truncated = 0
    errors: list[str] = []

    def work(path: Path) -> tuple[Path, str, int, bool]:
        text = path.read_text(encoding="utf-8")
        front = text.split("---", 2)[1]
        match = re.search(r'^linear_id: "(.*)"$', front, re.M)
        if not match:
            raise RuntimeError(f"missing linear_id in {path.name}")
        identifier = match.group(1)
        comments = graphql(token, identifier)
        block, count, was_truncated = comment_block(identifier, comments)
        return path, text.rstrip() + "\n" + block, count, was_truncated

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = {pool.submit(work, path): path for path in pending}
        for future in as_completed(futures):
            path = futures[future]
            try:
                target, text, count, was_truncated = future.result()
            except Exception as exc:  # noqa: BLE001 — surface the identifier, never the token
                errors.append(f"{path.name}: {exc}")
                print(f"FAILED {path.name}", flush=True)
                continue
            target.write_text(text, encoding="utf-8")
            written += 1
            if count == 0:
                empty += 1
            if was_truncated:
                truncated += 1
            print(f"{target.name} comments={count}", flush=True)

    del token
    print(json.dumps({"written": written, "empty": empty, "truncated": truncated, "failed": len(errors)}))
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
