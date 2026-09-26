"""Resolve the live WCP queue directory. Matches src/paths.ts wcpDirName."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

WCP_DIR_NAME = ".wcp"
LEGACY_WCP_DIR_NAME = ".WCP"
QUEUE_FOLDERS = ("open", "in-progress", "in-review", "done", "canceled", "blocked")
LINEAR_IDENTIFIER_RE = re.compile(r"^[A-Z][A-Z0-9]+-\d+$")
LINEAR_ID_LINE = re.compile(r"^linear_id:\s*(.*)$", re.M)


def dir_names(root: Path) -> list[str]:
    try:
        return os.listdir(root)
    except FileNotFoundError:
        return []


def wcp_dir_names(root: Path) -> dict[str, bool]:
    names = dir_names(root)
    return {
        "canonical": WCP_DIR_NAME in names,
        "legacy": LEGACY_WCP_DIR_NAME in names,
    }


def wcp_dir_name_from_entries(names: list[str]) -> str:
    if WCP_DIR_NAME in names:
        return WCP_DIR_NAME
    if LEGACY_WCP_DIR_NAME in names:
        return LEGACY_WCP_DIR_NAME
    return WCP_DIR_NAME


def wcp_dir_name(root: Path) -> str:
    return wcp_dir_name_from_entries(dir_names(root))


def wcp_dir(root: Path) -> Path:
    return root / wcp_dir_name(root)


def issues_root(repo: Path) -> Path:
    return wcp_dir(repo) / "issues"


def parse_queue_folders(raw: str) -> list[str]:
    folders = [part.strip() for part in raw.split(",") if part.strip()]
    for folder in folders:
        if folder not in QUEUE_FOLDERS:
            raise ValueError(
                "folder names must be one of "
                + ", ".join(QUEUE_FOLDERS)
                + f"; got {folder!r}"
            )
    return folders


def is_linear_identifier(value: str) -> bool:
    return bool(LINEAR_IDENTIFIER_RE.fullmatch(value or ""))


def require_linear_identifier(value: str) -> str:
    if not is_linear_identifier(value):
        raise ValueError(f"linear_id is not a Linear identifier: {value!r}")
    return value


def parse_linear_id(text: str) -> str | None:
    match = LINEAR_ID_LINE.search(text)
    if not match:
        return None
    raw = match.group(1).strip()
    if not raw:
        return None
    if raw.startswith('"'):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return None
        text_id = str(parsed).strip()
        return text_id or None
    return raw


def resolve_under_issues(issues: Path, path: Path) -> Path:
    root = issues.resolve()
    resolved = path.resolve()
    if resolved == root or not resolved.is_relative_to(root):
        raise ValueError(f"{path} is not under the issues root")
    rel = resolved.relative_to(root)
    if not rel.parts or rel.parts[0] not in QUEUE_FOLDERS:
        raise ValueError(f"{path} is not under a queue status folder")
    return resolved
