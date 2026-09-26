#!/usr/bin/env python3
"""Import Linear issues into a repo's .wcp/issues queue.

Reads the Linear token from the named MCP server in ~/.grok/config.toml.
Does not print the token, the Authorization header, or the config file.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import tomllib
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

API = "https://api.linear.app/graphql"
FOLDERS = ("open", "in-progress", "in-review", "done", "canceled", "blocked")
QUERY = """
query($cursor: String, $teams: [String!]) {
  issues(
    first: 50
    after: $cursor
    includeArchived: true
    filter: { team: { key: { in: $teams } } }
  ) {
    pageInfo { hasNextPage endCursor }
    nodes {
      identifier
      title
      description
      url
      priority
      priorityLabel
      estimate
      createdAt
      updatedAt
      completedAt
      canceledAt
      archivedAt
      dueDate
      branchName
      state { name type }
      assignee { name email }
      team { key name }
      project { name }
      cycle { number name }
      labels { nodes { name } }
      parent { identifier title }
    }
  }
}
"""


def parse_teams(values: list[str]) -> list[str]:
    teams: list[str] = []
    for value in values:
        for part in value.split(","):
            key = part.strip()
            if key and key not in teams:
                teams.append(key)
    if not teams:
        raise SystemExit("Pass at least one Linear team key via --teams")
    return teams


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


def graphql(token: str, teams: list[str], cursor: str | None) -> dict:
    payload = json.dumps(
        {"query": QUERY, "variables": {"cursor": cursor, "teams": teams}}
    ).encode()
    req = urllib.request.Request(
        API,
        data=payload,
        headers={"Authorization": token, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"Linear HTTP {exc.code}") from None
    if body.get("errors"):
        messages = [err.get("message", "graphql error") for err in body["errors"]]
        raise SystemExit("Linear query failed: " + "; ".join(messages))
    return body["data"]["issues"]


def yml(value) -> str:
    if value is None:
        return '""'
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, list):
        return "[" + ", ".join(json.dumps(str(item), ensure_ascii=False) for item in value) + "]"
    return json.dumps(str(value), ensure_ascii=False)


def slug(title: str) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", (title or "").lower()).strip("-")
    text = text[:48].strip("-")
    return text or "issue"


def number_of(identifier: str) -> int:
    match = re.search(r"(\d+)$", identifier or "")
    if not match:
        raise SystemExit(f"Identifier has no number: {identifier}")
    return int(match.group(1))


def map_status(state_type: str, state_name: str) -> tuple[str, str]:
    name = (state_name or "").strip()
    low = name.lower()
    kind = (state_type or "").strip().lower()
    if kind == "completed" or low in {"done", "completed"}:
        return "done", ""
    if kind == "canceled" or low in {"canceled", "cancelled", "duplicate"}:
        reason = f"Imported from Linear status {name or kind}."
        return "canceled", reason
    if "block" in low:
        return "blocked", f"Imported from Linear status {name}."
    # Triage, Backlog, Todo, In Progress, and In Review stay open.
    # in-progress would look leased, and in-review would start reviewers.
    return "open", ""


def priority_of(value) -> str:
    # Linear: 1 Urgent, 2 High, 3 Medium, 4 Low, 0 None.
    # This importer maps 3, 4, and 0 to normal.
    try:
        number = int(value or 0)
    except (TypeError, ValueError):
        return "normal"
    return {1: "critical", 2: "high", 3: "normal", 4: "normal"}.get(number, "normal")


def person(node) -> str:
    if not node:
        return ""
    name = (node.get("name") or "").strip()
    email = (node.get("email") or "").strip()
    if name and email:
        return f"{name} <{email}>"
    return name or email


def acceptance(description: str | None) -> str:
    if not description:
        return "Meet the imported Linear issue."
    line = ""
    for raw in description.splitlines():
        stripped = raw.strip().lstrip("#").strip("- ").strip()
        if stripped:
            line = stripped
            break
    if not line:
        return "Meet the imported Linear issue."
    if len(line) > 180:
        line = line[:177].rstrip() + "..."
    return line


def render(issue: dict, wcp_id: str, status: str, reason: str) -> str:
    state = issue.get("state") or {}
    team = issue.get("team") or {}
    project = issue.get("project") or {}
    cycle = issue.get("cycle") or {}
    parent = issue.get("parent") or {}
    labels = [node.get("name") or "" for node in (issue.get("labels") or {}).get("nodes") or []]
    labels = [label for label in labels if label]
    description = issue.get("description") or ""
    cycle_label = ""
    if cycle:
        number = cycle.get("number")
        name = cycle.get("name") or ""
        cycle_label = f"{number} {name}".strip() if number is not None else name
    lines = [
        "---",
        f"id: {yml(wcp_id)}",
        f"title: {yml(issue.get('title') or issue['identifier'])}",
        f"status: {status}",
        f"priority: {priority_of(issue.get('priority'))}",
        "assignee:",
        "lease_expires:",
        f"scope: {yml('Imported from Linear ' + issue['identifier'] + '. Stay inside that description.')}",
        f"acceptance: {yml(acceptance(description))}",
        "files: []",
        "commit:",
        f"reason: {yml(reason) if reason else ''}".rstrip(),
        f"created: {yml(issue.get('createdAt') or '')}",
        f"linear_id: {yml(issue['identifier'])}",
        f"linear_url: {yml(issue.get('url') or '')}",
        f"linear_status: {yml(state.get('name') or '')}",
        f"linear_status_type: {yml(state.get('type') or '')}",
        f"linear_team: {yml(team.get('key') or '')}",
        f"linear_project: {yml(project.get('name') or '')}",
        f"linear_assignee: {yml(person(issue.get('assignee')))}",
        f"linear_labels: {yml(labels)}",
        f"linear_priority: {yml(issue.get('priorityLabel') or '')}",
        f"linear_parent: {yml(parent.get('identifier') or '')}",
        f"linear_cycle: {yml(cycle_label)}",
        f"linear_due: {yml(issue.get('dueDate') or '')}",
        f"linear_updated: {yml(issue.get('updatedAt') or '')}",
        f"linear_archived: {yml(bool(issue.get('archivedAt')))}",
        "notion_page_id:",
        "notion_url:",
        "---",
        "",
        "## Linear import",
        "",
        f"- Identifier: {issue['identifier']}",
        f"- URL: {issue.get('url') or ''}",
        f"- Linear status: {state.get('name') or ''} ({state.get('type') or ''})",
        f"- Queue status: {status}",
        f"- Team: {team.get('name') or ''} ({team.get('key') or ''})",
        f"- Project: {project.get('name') or ''}",
        f"- Assignee: {person(issue.get('assignee')) or 'unassigned'}",
        f"- Labels: {', '.join(labels) if labels else 'none'}",
        f"- Parent: {parent.get('identifier') or 'none'}"
        + (f" — {parent.get('title')}" if parent.get("title") else ""),
        f"- Priority: {issue.get('priorityLabel') or 'none'}",
        f"- Estimate: {issue.get('estimate') if issue.get('estimate') is not None else 'none'}",
        f"- Cycle: {cycle_label or 'none'}",
        f"- Due: {issue.get('dueDate') or 'none'}",
        f"- Created: {issue.get('createdAt') or ''}",
        f"- Updated: {issue.get('updatedAt') or ''}",
        f"- Completed: {issue.get('completedAt') or 'no'}",
        f"- Canceled: {issue.get('canceledAt') or 'no'}",
        f"- Archived: {issue.get('archivedAt') or 'no'}",
        f"- Branch: {issue.get('branchName') or 'none'}",
        "",
        "Queue status follows Water Cooler Protocol. Todo, In Progress, In Review, Triage, and Backlog are `open` so the import does not take a ticket lease or start a review. Done, Canceled, and Blocked use those folders. `linear_status` is the Linear status at import.",
        "",
        "## Description",
        "",
        description.strip() if description.strip() else "_No description in Linear._",
        "",
    ]
    return "\n".join(lines)


def assign_ids(found: list[dict], teams: list[str], rule: str) -> tuple[dict[str, str], list[str]]:
    assigned: dict[str, str] = {}
    notes: list[str] = []
    if rule == "identity":
        used: dict[int, str] = {}
        for issue in found:
            number = number_of(issue["identifier"])
            previous = used.get(number)
            if previous:
                raise SystemExit(
                    f"Issue numbers collide under --id-rule identity: {previous} and {issue['identifier']}"
                )
            used[number] = issue["identifier"]
            assigned[issue["identifier"]] = f"{number:04d}"
        return assigned, notes
    if rule == "primary-then-rest":
        primary = teams[0]
        used_numbers: set[int] = set()
        for issue in found:
            team = (issue.get("team") or {}).get("key") or ""
            if team != primary:
                continue
            number = number_of(issue["identifier"])
            if number in used_numbers:
                raise SystemExit(f"Duplicate {primary} number {number}")
            assigned[issue["identifier"]] = f"{number:04d}"
            used_numbers.add(number)
        next_id = (max(used_numbers) + 1) if used_numbers else 1
        others = [
            issue
            for issue in found
            if ((issue.get("team") or {}).get("key") or "") != primary
        ]
        for issue in sorted(
            others,
            key=lambda item: (
                (item.get("team") or {}).get("key") or "",
                number_of(item["identifier"]),
            ),
        ):
            while next_id in used_numbers:
                next_id += 1
            wcp_id = f"{next_id:04d}"
            assigned[issue["identifier"]] = wcp_id
            used_numbers.add(next_id)
            notes.append(f"{issue['identifier']} -> {wcp_id}")
            next_id += 1
        return assigned, notes
    raise SystemExit("Unknown --id-rule. Use identity or primary-then-rest")


def fetch_all(token: str, teams: list[str]) -> list[dict]:
    cursor = None
    found: list[dict] = []
    pages = 0
    allowed = set(teams)
    while True:
        page = graphql(token, teams, cursor)
        nodes = page["nodes"]
        unexpected = sorted(
            {
                (issue.get("team") or {}).get("key") or "?"
                for issue in nodes
                if ((issue.get("team") or {}).get("key") or "") not in allowed
            }
        )
        if unexpected:
            raise SystemExit(
                "Linear returned teams outside --teams "
                + ", ".join(teams)
                + ": "
                + ", ".join(unexpected)
            )
        found.extend(nodes)
        pages += 1
        print(f"page {pages}: {len(nodes)} issues, total {len(found)}", flush=True)
        if not page["pageInfo"]["hasNextPage"]:
            break
        cursor = page["pageInfo"]["endCursor"]
    return found


def filename_for(issue: dict, wcp_id: str) -> str:
    return f"{wcp_id}-{issue['identifier'].lower()}-{slug(issue.get('title') or '')}.md"


def build_summary(found: list[dict], assigned: dict[str, str], notes: list[str], rule: str) -> dict:
    status_counts: Counter[str] = Counter()
    linear_counts: Counter[str] = Counter()
    linear_names: Counter[str] = Counter()
    team_counts: Counter[str] = Counter()
    priorities: Counter[str] = Counter()
    projects: set[str] = set()
    labels: set[str] = set()
    numbers: list[int] = []
    archived = 0
    for issue in found:
        state = issue.get("state") or {}
        status, _reason = map_status(state.get("type") or "", state.get("name") or "")
        status_counts[status] += 1
        linear_counts[f"{state.get('name') or '?'} ({state.get('type') or '?'})"] += 1
        linear_names[state.get("name") or "?"] += 1
        team_counts[(issue.get("team") or {}).get("key") or "?"] += 1
        priorities[str(issue.get("priority") if issue.get("priority") is not None else 0)] += 1
        project = ((issue.get("project") or {}).get("name") or "").strip()
        if project:
            projects.add(project)
        for node in (issue.get("labels") or {}).get("nodes") or []:
            label = (node.get("name") or "").strip()
            if label:
                labels.add(label)
        numbers.append(number_of(issue["identifier"]))
        if issue.get("archivedAt"):
            archived += 1
    missing: list[int] = []
    if numbers:
        want = set(range(min(numbers), max(numbers) + 1))
        have = set(numbers)
        missing = sorted(want - have)
    return {
        "total": len(found),
        "wcp_status": dict(status_counts),
        "linear_status": dict(sorted(linear_counts.items())),
        "linear_status_name": dict(sorted(linear_names.items())),
        "teams": dict(team_counts),
        "priorities": dict(sorted(priorities.items())),
        "projects": sorted(projects),
        "labels": sorted(labels),
        "archived": archived,
        "number_min": min(numbers) if numbers else None,
        "number_max": max(numbers) if numbers else None,
        "missing_numbers": missing,
        "duplicate_numbers": sorted(
            number for number, count in Counter(numbers).items() if count > 1
        ),
        "id_rule": rule,
        "id_map_notes": notes,
        "assigned": len(assigned),
    }


def expect_ok(summary: dict, args: argparse.Namespace) -> list[str]:
    problems: list[str] = []
    checks = (
        ("total", args.expect_total),
        ("open", args.expect_open),
        ("done", args.expect_done),
        ("canceled", args.expect_canceled),
    )
    for name, expected in checks:
        if expected is None:
            continue
        if name == "total":
            actual = summary["total"]
        else:
            actual = summary["wcp_status"].get(name, 0)
        if actual != expected:
            problems.append(f"{name}: expected {expected}, got {actual}")
    if args.require_span:
        start_s, end_s = args.require_span.split(":", 1)
        start, end = int(start_s), int(end_s)
        if summary["number_min"] != start or summary["number_max"] != end:
            problems.append(
                f"span: expected {start}..{end}, got {summary['number_min']}..{summary['number_max']}"
            )
        if summary["missing_numbers"] or summary["duplicate_numbers"]:
            problems.append(
                "span gaps or duplicates: missing "
                + ",".join(str(n) for n in summary["missing_numbers"][:20])
                + " duplicates "
                + ",".join(str(n) for n in summary["duplicate_numbers"][:20])
            )
        if summary["total"] != (end - start + 1):
            problems.append(
                f"span count: expected {end - start + 1}, got {summary['total']}"
            )
    return problems


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, type=Path, help="Checkout that receives .wcp/issues")
    parser.add_argument("--server", required=True, help="MCP server name in the grok config")
    parser.add_argument("--teams", required=True, nargs="+", help="Linear team key(s)")
    parser.add_argument(
        "--id-rule",
        required=True,
        choices=("identity", "primary-then-rest"),
        help="identity keeps each issue number; primary-then-rest keeps the first team and appends the rest",
    )
    parser.add_argument("--config", type=Path, default=Path.home() / ".grok" / "config.toml")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and print counts. Write nothing")
    parser.add_argument("--force", action="store_true", help="Overwrite issue files that already exist")
    parser.add_argument("--expect-total", type=int)
    parser.add_argument("--expect-open", type=int)
    parser.add_argument("--expect-done", type=int)
    parser.add_argument("--expect-canceled", type=int)
    parser.add_argument("--require-span", help="MIN:MAX inclusive issue numbers with no gaps")
    args = parser.parse_args()

    teams = parse_teams(args.teams)
    token = load_token(args.config, args.server)
    found = fetch_all(token, teams)
    del token

    seen: dict[tuple[str, int], str] = {}
    for issue in found:
        key = ((issue.get("team") or {}).get("key") or "", number_of(issue["identifier"]))
        if key in seen:
            raise SystemExit(f"Duplicate identifier: {seen[key]} and {issue['identifier']}")
        seen[key] = issue["identifier"]

    assigned, notes = assign_ids(found, teams, args.id_rule)
    summary = build_summary(found, assigned, notes, args.id_rule)
    print("Linear status:")
    for name, count in summary["linear_status"].items():
        print(f"  {name}: {count}")
    print("WCP status:")
    for name in FOLDERS:
        print(f"  {name}: {summary['wcp_status'].get(name, 0)}")
    print(f"total: {summary['total']}")
    print(json.dumps(summary, indent=2))

    problems = expect_ok(summary, args)
    if problems:
        print("EXPECTATION FAILED", file=sys.stderr)
        for problem in problems:
            print(problem, file=sys.stderr)
        raise SystemExit(3)
    if args.dry_run:
        return

    issues_root = args.repo / ".wcp" / "issues"
    existing = list(issues_root.rglob("*.md")) if issues_root.exists() else []
    if existing and not args.force:
        raise SystemExit(
            f"{len(existing)} issue files already exist under {issues_root}. Pass --force to overwrite."
        )
    for folder in FOLDERS:
        (issues_root / folder).mkdir(parents=True, exist_ok=True)

    written = 0
    for issue in sorted(found, key=lambda item: assigned[item["identifier"]]):
        state = issue.get("state") or {}
        status, reason = map_status(state.get("type") or "", state.get("name") or "")
        wcp_id = assigned[issue["identifier"]]
        path = issues_root / status / filename_for(issue, wcp_id)
        path.write_text(render(issue, wcp_id, status, reason), encoding="utf-8")
        written += 1
    print(json.dumps({"written": written, "root": str(issues_root)}))


if __name__ == "__main__":
    main()
