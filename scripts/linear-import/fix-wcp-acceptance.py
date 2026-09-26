#!/usr/bin/env python3
"""Replace heading-only acceptance lines with a real sentence from the body."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

SKIP = {
    "summary",
    "implementer contract",
    "user report",
    "request",
    "problem",
    "feedback ticket",
    "initiative",
    "context",
    "goal",
    "report",
    "current behavior",
    "expected behavior",
    "acceptance criteria",
    "description",
    "linear import",
}


def clean(text: str) -> str:
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = text.replace("**", "").replace("`", "")
    text = re.sub(r"\s+", " ", text).strip(" -*")
    if len(text) > 180:
        text = text[:177].rstrip() + "..."
    return text


def section(body: str, heading: str) -> str:
    match = re.search(rf"(?m)^## {re.escape(heading)}\s*$", body)
    if not match:
        return ""
    rest = body[match.end() :]
    nxt = re.search(r"(?m)^## ", rest)
    return rest[: nxt.start()] if nxt else rest


def bullets(text: str) -> list[str]:
    found = []
    for raw in text.splitlines():
        line = raw.strip()
        matched = re.match(r"^(?:[-*]|\d+\.)\s+(?:\[[ xX]\]\s+)?(.+)$", line)
        if not matched:
            continue
        item = clean(matched.group(1))
        if len(item) < 24:
            continue
        if item.lower() in SKIP:
            continue
        found.append(item)
    return found


def prose(text: str) -> str:
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith(("#", ">", "-", "*", "|")):
            continue
        item = clean(line)
        if len(item) < 40 or item.lower() in SKIP:
            continue
        return item
    return ""


def acceptance(body: str, linear_id: str) -> str:
    for heading in ("Acceptance criteria", "Expected behavior"):
        items = bullets(section(body, heading))
        if items:
            return items[0]
    summary = prose(section(body, "Summary"))
    if summary:
        return summary
    description = prose(section(body, "Description"))
    if description:
        return description
    return f"Meet the imported Linear description for {linear_id}."


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    root = args.repo / ".WCP" / "issues"
    changed = 0
    for path in sorted(root.rglob("*.md")):
        text = path.read_text(encoding="utf-8")
        _prefix, front, body = text.split("---", 2)
        linear = re.search(r'^linear_id: "(.*)"$', front, re.M)
        linear_id = linear.group(1) if linear else path.name
        new_value = json.dumps(acceptance(body, linear_id), ensure_ascii=False)
        new_front, count = re.subn(
            r"(?m)^acceptance: .*$",
            f"acceptance: {new_value}",
            front,
            count=1,
        )
        if count != 1:
            raise SystemExit(f"acceptance line missing in {path}")
        if new_front != front:
            changed += 1
            if not args.dry_run:
                path.write_text(f"---{new_front}---{body}", encoding="utf-8")
    print(f"updated {changed}")


if __name__ == "__main__":
    main()
