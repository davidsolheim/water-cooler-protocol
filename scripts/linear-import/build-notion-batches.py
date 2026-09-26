#!/usr/bin/env python3
"""Build Notion create-pages batches from .WCP/issues. Skips pages already mirrored."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def grab(front: str, key: str):
    match = re.search(rf"^{re.escape(key)}: (.*)$", front, re.M)
    if not match:
        return ""
    raw = match.group(1).strip()
    if raw.startswith('"'):
        return json.loads(raw)
    return raw


def labels_of(front: str) -> list[str]:
    match = re.search(r"^linear_labels: (.*)$", front, re.M)
    if not match:
        return []
    raw = match.group(1).strip()
    if not raw or raw == "[]":
        return []
    if raw.startswith("["):
        parsed = json.loads(raw)
        return [str(item) for item in parsed]
    return []


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--data-source", required=True, help="Notion data source id")
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--tool-name", default="notion__notion-create-pages")
    parser.add_argument("--batch", type=int, default=80)
    parser.add_argument("--title-property", default="Issue name")
    parser.add_argument("--url-property", default="Issue URL")
    parser.add_argument("--dry-run", action="store_true", help="Count pages and write nothing")
    args = parser.parse_args()
    if args.batch < 1 or args.batch > 80:
        raise SystemExit("--batch must be from 1 to 80")

    root = args.repo / ".WCP" / "issues"
    pages = []
    index = []
    for path in sorted(root.rglob("*.md")):
        text = path.read_text(encoding="utf-8")
        front = text.split("---", 2)[1]
        linear = grab(front, "linear_id")
        if grab(front, "notion_page_id"):
            continue
        title = grab(front, "title") or linear
        wcp = grab(front, "id")
        url = grab(front, "linear_url")
        acceptance = grab(front, "acceptance")
        props = {
            args.title_property: title,
            "WCP": wcp,
            "Status": grab(front, "linear_status"),
            "Queue": grab(front, "status"),
            "Priority": grab(front, "priority") or "normal",
            "Team": grab(front, "linear_team"),
            "Archived": "__YES__" if str(grab(front, "linear_archived")).lower() == "true" else "__NO__",
        }
        if url:
            props[args.url_property] = url
        assignee = grab(front, "linear_assignee")
        if assignee:
            props["Assignee"] = assignee
        project = grab(front, "linear_project")
        if project:
            props["Project"] = project
        parent = grab(front, "linear_parent")
        if parent:
            props["Parent"] = parent
        due = grab(front, "linear_due")
        if due:
            props["date:Due:start"] = due
            props["date:Due:is_datetime"] = 0
        labels = labels_of(front)
        if labels:
            props["Labels"] = labels
        rel = path.relative_to(args.repo).as_posix()
        content = (
            f"WCP `{wcp}`. Linear [{linear}]({url}).\n\n"
            f"{acceptance}\n\n"
            f"Full spec: `{rel}`"
        )
        pages.append({"properties": props, "content": content})
        index.append({"linear": linear, "wcp": wcp, "path": str(path)})

    print(json.dumps({"pages": len(pages), "batch": args.batch, "dry_run": args.dry_run}))
    if args.dry_run:
        return

    args.out.mkdir(parents=True, exist_ok=True)
    batches = []
    for start in range(0, len(pages), args.batch):
        number = start // args.batch
        payload = {
            "tool_name": args.tool_name,
            "tool_input": {
                "parent": {"type": "data_source_id", "data_source_id": args.data_source},
                "allow_async": False,
                "pages": pages[start : start + args.batch],
            },
        }
        path = args.out / f"batch-{number:02d}.json"
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        (args.out / f"index-{number:02d}.json").write_text(
            json.dumps(index[start : start + args.batch], ensure_ascii=False),
            encoding="utf-8",
        )
        batches.append(
            {
                "file": str(path),
                "count": len(payload["tool_input"]["pages"]),
                "bytes": path.stat().st_size,
            }
        )
    print(json.dumps({"pages": len(pages), "batches": batches}, indent=2))


if __name__ == "__main__":
    main()
