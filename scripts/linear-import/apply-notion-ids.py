#!/usr/bin/env python3
"""Write Notion page ids from create-pages JSON results into WCP frontmatter."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from wcp_paths import front_value, frontmatter_block, issues_root, parse_linear_id, write_under_issues


def pages_from(data) -> list[dict]:
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if not isinstance(data, dict):
        return []
    pages = data.get("pages")
    if isinstance(pages, list):
        return [item for item in pages if isinstance(item, dict)]
    result = data.get("result")
    if isinstance(result, dict):
        return pages_from(result)
    if isinstance(result, str):
        try:
            return pages_from(json.loads(result))
        except json.JSONDecodeError:
            return []
    return []


def notion_filled(text: str) -> bool:
    front = frontmatter_block(text)
    return bool(front_value(front, "notion_page_id")) and bool(front_value(front, "notion_url"))


def fill_notion_ids(root: Path, path: Path, page_id: str, url: str) -> bool:
    text = path.read_text(encoding="utf-8")
    front = frontmatter_block(text)
    has_page = bool(front_value(front, "notion_page_id"))
    has_url = bool(front_value(front, "notion_url"))
    if has_page and has_url:
        return False
    updated = text
    if not has_page:
        updated, n1 = re.subn(
            r"(?m)^notion_page_id:\s*$",
            f"notion_page_id: {json.dumps(page_id)}",
            updated,
            count=1,
        )
        if n1 != 1:
            raise SystemExit(f"notion_page_id slot missing in {path}")
    if not has_url:
        updated, n2 = re.subn(
            r"(?m)^notion_url:\s*$",
            f"notion_url: {json.dumps(url)}",
            updated,
            count=1,
        )
        if n2 != 1:
            raise SystemExit(f"notion_url slot missing in {path}")
    write_under_issues(root, path, updated)
    return True


def is_tool_request(data) -> bool:
    """Create-pages request payloads are named batch-*.json. Results can use that name too."""
    return isinstance(data, dict) and "tool_name" in data and "tool_input" in data


def load_pages(sources: list[Path]) -> dict[str, tuple[str, str]]:
    found: dict[str, tuple[str, str]] = {}
    for source in sources:
        paths = [source] if source.is_file() else sorted(source.glob("*.json"))
        for path in paths:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            if is_tool_request(data):
                continue
            for page in pages_from(data):
                props = page.get("properties") or {}
                wcp = str(props.get("WCP") or "")
                page_id = page.get("id") or ""
                url = page.get("url") or ""
                if wcp and page_id and url:
                    found[wcp] = (page_id, url.split("?", 1)[0])
    return found


def issue_id(text: str) -> str:
    parts = text.split("---", 2)
    if len(parts) < 3:
        return ""
    value = front_value(parts[1], "id")
    if value is None:
        return ""
    return str(value).strip()


def queue_by_id(root: Path) -> dict[str, Path]:
    found: dict[str, Path] = {}
    if not root.exists():
        return found
    for path in sorted(root.rglob("*.md")):
        wcp = issue_id(path.read_text(encoding="utf-8"))
        if wcp:
            found[wcp] = path
    return found


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument(
        "--results",
        required=True,
        type=Path,
        help="JSON file or directory of Notion create-pages results",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    root = issues_root(args.repo)
    found = load_pages([args.results])
    by_id = queue_by_id(root)
    filled = 0
    missing = []
    for wcp, path in by_id.items():
        text = path.read_text(encoding="utf-8")
        if not parse_linear_id(text):
            continue
        if notion_filled(text):
            filled += 1
        else:
            missing.append(wcp)

    updated = 0
    already = 0
    missing_files = 0
    if not args.dry_run:
        for wcp, (page_id, url) in sorted(found.items()):
            path = by_id.get(wcp)
            if path is None:
                missing_files += 1
                continue
            if fill_notion_ids(root, path, page_id, url):
                updated += 1
            else:
                already += 1

    filled_after = 0
    missing_after = []
    for wcp, path in queue_by_id(root).items():
        text = path.read_text(encoding="utf-8")
        if not parse_linear_id(text):
            continue
        if notion_filled(text):
            filled_after += 1
        else:
            missing_after.append(wcp)

    print(
        json.dumps(
            {
                "known": len(found),
                "updated": updated,
                "already": already,
                "missing_files": missing_files,
                "filled": filled_after,
                "missing": len(missing_after),
                "missing_ids": missing_after[:20],
                "files": len(by_id),
                "filled_before": filled,
                "missing_before": len(missing),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
