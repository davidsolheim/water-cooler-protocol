#!/usr/bin/env python3
"""Replace heading-only acceptance lines with a real sentence from the body."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from wcp_paths import issues_root, write_under_issues

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


REWRITABLE_ACCEPTANCE = {
    "",
    "Acceptance criteria",
    "Expected behavior",
    "Meet the imported Linear issue.",
}


def rewrite_acceptance(root: Path, path: Path, dry_run: bool = False) -> bool:
    text = path.read_text(encoding="utf-8")
    _prefix, front, body = text.split("---", 2)
    linear = re.search(r'^linear_id: "(.*)"$', front, re.M)
    if not linear:
        return False
    linear_id = linear.group(1)
    current = ""
    current_match = re.search(r'(?m)^acceptance: (.*)$', front)
    if current_match:
        raw = current_match.group(1).strip()
        if raw.startswith('"'):
            try:
                current = str(json.loads(raw))
            except json.JSONDecodeError:
                current = raw
        else:
            current = raw
    new_plain = acceptance(body, linear_id)
    allowed = set(REWRITABLE_ACCEPTANCE)
    allowed.add(f"Meet the imported Linear description for {linear_id}.")
    if current and current not in allowed and current != new_plain:
        return False
    new_value = json.dumps(new_plain, ensure_ascii=False)
    new_front, count = re.subn(
        r"(?m)^acceptance: .*$",
        f"acceptance: {new_value}",
        front,
        count=1,
    )
    if count != 1:
        raise SystemExit(f"acceptance line missing in {path}")
    if new_front == front:
        return False
    if not dry_run:
        write_under_issues(root, path, f"---{new_front}---{body}")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    root = issues_root(args.repo)
    changed = 0
    for path in sorted(root.rglob("*.md")):
        if rewrite_acceptance(root, path, dry_run=args.dry_run):
            changed += 1
    print(f"updated {changed}")


if __name__ == "__main__":
    main()
