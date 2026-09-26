#!/usr/bin/env python3
"""Write Notion page ids from create-pages JSON results into WCP frontmatter."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


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


def load_pages(sources: list[Path]) -> dict[str, tuple[str, str]]:
    found: dict[str, tuple[str, str]] = {}
    for source in sources:
        paths = [source] if source.is_file() else sorted(source.glob("*.json"))
        for path in paths:
            if path.name.startswith("index-") or path.name.startswith("batch-"):
                continue
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            for page in pages_from(data):
                props = page.get("properties") or {}
                wcp = str(props.get("WCP") or "")
                page_id = page.get("id") or ""
                url = page.get("url") or ""
                if wcp and page_id and url:
                    found[wcp] = (page_id, url.split("?", 1)[0])
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

    root = args.repo / ".wcp" / "issues"
    found = load_pages([args.results])
    by_id: dict[str, Path] = {}
    filled = 0
    missing = []
    for path in sorted(root.rglob("*.md")):
        text = path.read_text(encoding="utf-8")
        front = text.split("---", 2)[1]
        match = re.search(r'^id: "(.*)"$', front, re.M)
        if not match:
            continue
        wcp = match.group(1)
        by_id[wcp] = path
        if re.search(r'^notion_page_id: ".+"$', text, re.M):
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
            text = path.read_text(encoding="utf-8")
            if re.search(r'^notion_page_id: ".+"$', text, re.M):
                already += 1
                continue
            text2, n1 = re.subn(
                r"(?m)^notion_page_id:\s*$",
                f"notion_page_id: {json.dumps(page_id)}",
                text,
                count=1,
            )
            text3, n2 = re.subn(
                r"(?m)^notion_url:\s*$",
                f"notion_url: {json.dumps(url)}",
                text2,
                count=1,
            )
            if n1 != 1 or n2 != 1:
                raise SystemExit(f"frontmatter slots missing in {path}")
            path.write_text(text3, encoding="utf-8")
            updated += 1

    filled_after = 0
    missing_after = []
    for path in sorted(root.rglob("*.md")):
        text = path.read_text(encoding="utf-8")
        front = text.split("---", 2)[1]
        match = re.search(r'^id: "(.*)"$', front, re.M)
        if not match:
            continue
        if re.search(r'^notion_page_id: ".+"$', text, re.M) and re.search(
            r'^notion_url: "https?://.+"$', text, re.M
        ):
            filled_after += 1
        else:
            missing_after.append(match.group(1))

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
