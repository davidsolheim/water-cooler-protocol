#!/usr/bin/env python3
"""Unit tests for Linear import path resolution, --force replacement, allowlists, and comment batching.

# WCP prb-fix: scripts/linear-import/import-linear-to-wcp.py --force replaces stale linear_id files (fix linear-import)
# WCP prb-fix: scripts/linear-import/import-linear-comments.py folder/id allowlist and batched comments query (fix linear-import)
# WCP prb-fix: scripts/linear-import/apply-notion-ids.py resolve issues root like wcpDirName (fix linear-import)
# WCP prb-fix: scripts/linear-import/build-notion-batches.py resolve issues root like wcpDirName (fix linear-import)
# WCP prb-fix: scripts/linear-import/fix-wcp-acceptance.py resolve issues root like wcpDirName (fix linear-import)
"""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from wcp_paths import (
    LEGACY_WCP_DIR_NAME,
    QUEUE_FOLDERS,
    WCP_DIR_NAME,
    is_linear_identifier,
    issues_root,
    parse_linear_id,
    parse_queue_folders,
    require_linear_identifier,
    resolve_under_issues,
    wcp_dir_name,
    wcp_dir_name_from_entries,
    wcp_dir_names,
)


def load_script(filename: str):
    path = Path(__file__).resolve().parent / filename
    spec = importlib.util.spec_from_file_location(path.stem.replace("-", "_"), path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {filename}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def issue_md(linear_id: str, wcp_id: str = "0007", extra: str = "") -> str:
    return (
        "---\n"
        f'id: "{wcp_id}"\n'
        f'linear_id: "{linear_id}"\n'
        "status: open\n"
        "---\n\n"
        f"body{extra}\n"
    )


class WcpDirNameTests(unittest.TestCase):
    def test_entries_prefer_canonical_when_both_exist(self) -> None:
        self.assertEqual(
            wcp_dir_name_from_entries([".wcp", ".WCP", "src"]),
            WCP_DIR_NAME,
        )

    def test_entries_use_legacy_when_it_is_the_only_queue_dir(self) -> None:
        self.assertEqual(wcp_dir_name_from_entries([".WCP", "src"]), LEGACY_WCP_DIR_NAME)

    def test_entries_default_to_canonical_when_absent(self) -> None:
        self.assertEqual(wcp_dir_name_from_entries(["src"]), WCP_DIR_NAME)

    def test_entries_match_is_exact_not_casefold(self) -> None:
        self.assertEqual(wcp_dir_name_from_entries([".Wcp"]), WCP_DIR_NAME)
        self.assertEqual(wcp_dir_name_from_entries([".WCP"]), LEGACY_WCP_DIR_NAME)

    def test_live_legacy_only_tree(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / LEGACY_WCP_DIR_NAME / "issues" / "open").mkdir(parents=True)
            self.assertEqual(wcp_dir_names(root), {"canonical": False, "legacy": True})
            self.assertEqual(wcp_dir_name(root), LEGACY_WCP_DIR_NAME)
            self.assertEqual(issues_root(root), root / LEGACY_WCP_DIR_NAME / "issues")

    def test_live_canonical_tree(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / WCP_DIR_NAME / "issues" / "open").mkdir(parents=True)
            self.assertEqual(wcp_dir_name(root), WCP_DIR_NAME)
            self.assertEqual(issues_root(root), root / WCP_DIR_NAME / "issues")

    def test_absent_queue_defaults_to_canonical(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.assertEqual(wcp_dir_name(root), WCP_DIR_NAME)
            self.assertEqual(issues_root(root), root / WCP_DIR_NAME / "issues")


class ForceReplaceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.importer = load_script("import-linear-to-wcp.py")

    def test_force_removes_stale_file_when_status_or_slug_changes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            issues = Path(tmp) / ".wcp" / "issues"
            stale = issues / "open" / "0007-soda-7-old-slug.md"
            dest = issues / "done" / "0007-soda-7-new-slug.md"
            stale.parent.mkdir(parents=True)
            dest.parent.mkdir(parents=True)
            stale.write_text(issue_md("SODA-7"), encoding="utf-8")
            (issues / "open" / "0008-soda-8-keep.md").write_text(
                issue_md("SODA-8", "0008"), encoding="utf-8"
            )
            removed = self.importer.replace_issue_file(
                issues, dest, issue_md("SODA-7", extra=" new"), "SODA-7"
            )
            self.assertFalse(stale.exists())
            self.assertTrue(dest.exists())
            self.assertIn("new", dest.read_text(encoding="utf-8"))
            self.assertTrue((issues / "open" / "0008-soda-8-keep.md").exists())
            self.assertEqual([path.resolve() for path in removed], [stale.resolve()])

    def test_force_does_not_leave_two_files_with_the_same_linear_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            issues = Path(tmp) / ".wcp" / "issues"
            first = issues / "open" / "0007-soda-7-a.md"
            second = issues / "canceled" / "0007-soda-7-b.md"
            dest = issues / "done" / "0007-soda-7-c.md"
            first.parent.mkdir(parents=True)
            second.parent.mkdir(parents=True)
            dest.parent.mkdir(parents=True)
            first.write_text(issue_md("SODA-7"), encoding="utf-8")
            second.write_text(issue_md("SODA-7"), encoding="utf-8")
            self.importer.replace_issue_file(issues, dest, issue_md("SODA-7"), "SODA-7")
            remaining = [
                path
                for path in issues.rglob("*.md")
                if parse_linear_id(path.read_text(encoding="utf-8")) == "SODA-7"
            ]
            self.assertEqual([path.resolve() for path in remaining], [dest.resolve()])

    def test_overwrite_same_path_does_not_delete_the_destination(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            issues = Path(tmp) / ".wcp" / "issues"
            dest = issues / "open" / "0007-soda-7-same.md"
            dest.parent.mkdir(parents=True)
            dest.write_text(issue_md("SODA-7", extra=" old"), encoding="utf-8")
            self.importer.replace_issue_file(
                issues, dest, issue_md("SODA-7", extra=" new"), "SODA-7"
            )
            self.assertTrue(dest.exists())
            self.assertIn("new", dest.read_text(encoding="utf-8"))


class AllowlistTests(unittest.TestCase):
    def test_queue_folders_are_the_six_status_names(self) -> None:
        self.assertEqual(
            QUEUE_FOLDERS,
            ("open", "in-progress", "in-review", "done", "canceled", "blocked"),
        )

    def test_parse_queue_folders_accepts_the_six_names(self) -> None:
        self.assertEqual(parse_queue_folders("open,done"), ["open", "done"])
        self.assertEqual(parse_queue_folders(",".join(QUEUE_FOLDERS)), list(QUEUE_FOLDERS))

    def test_parse_queue_folders_rejects_escape_and_unknown_names(self) -> None:
        for raw in ("../../", "open/../done", "/tmp", "Open", "issues", "open,../done"):
            with self.assertRaises(ValueError):
                parse_queue_folders(raw)

    def test_linear_identifier_shape(self) -> None:
        self.assertTrue(is_linear_identifier("SODA-7"))
        self.assertTrue(is_linear_identifier("TW-331"))
        self.assertTrue(is_linear_identifier("A1-1"))
        for bad in (
            "",
            "soda-7",
            "SODA",
            "SODA-",
            "7",
            "../SODA-7",
            "SODA-7/../../etc",
            "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "SODA-7\nENG-1",
            " SODA-7",
        ):
            self.assertFalse(is_linear_identifier(bad), bad)
            with self.assertRaises(ValueError):
                require_linear_identifier(bad)

    def test_resolve_under_issues_rejects_paths_outside_the_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            root = repo / ".wcp" / "issues"
            (root / "open").mkdir(parents=True)
            inside = root / "open" / "0007-soda-7.md"
            inside.write_text(issue_md("SODA-7"), encoding="utf-8")
            self.assertEqual(resolve_under_issues(root, inside), inside.resolve())
            outside = repo / "secret.md"
            outside.write_text("nope\n", encoding="utf-8")
            escaped = root / "open" / ".." / ".." / ".." / "secret.md"
            with self.assertRaises(ValueError):
                resolve_under_issues(root, escaped)
            with self.assertRaises(ValueError):
                resolve_under_issues(root, outside)

    def test_resolve_under_issues_rejects_non_status_folder(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / ".wcp" / "issues"
            other = root / "other" / "0007-soda-7.md"
            other.parent.mkdir(parents=True)
            other.write_text(issue_md("SODA-7"), encoding="utf-8")
            with self.assertRaises(ValueError):
                resolve_under_issues(root, other)


class CommentBatchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.comments = load_script("import-linear-comments.py")

    def test_chunk_identifiers_size(self) -> None:
        ids = [f"SODA-{i}" for i in range(1, 52)]
        chunks = self.comments.chunk_identifiers(ids, 50)
        self.assertEqual(len(chunks), 2)
        self.assertEqual(chunks[0], ids[:50])
        self.assertEqual(chunks[1], ids[50:])
        self.assertEqual(self.comments.COMMENTS_BATCH_SIZE, 50)

    def test_batch_request_filters_identifiers_not_one_issue_id(self) -> None:
        ids = ["SODA-1", "SODA-2"]
        payload = self.comments.comments_batch_payload(ids)
        query = " ".join(payload["query"].split())
        self.assertEqual(payload["variables"]["ids"], ids)
        self.assertIn("identifier: { in: $ids }", query)
        self.assertIn("comments(first: 50)", query)
        self.assertIn("includeArchived: true", query)
        self.assertNotIn("issue(id: $id)", query)
        self.assertNotIn("issue(id:", query)
        json.dumps(payload)

    def test_collect_pending_skips_files_that_already_have_comments(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / ".wcp" / "issues"
            open_dir = root / "open"
            open_dir.mkdir(parents=True)
            pending = open_dir / "0007-soda-7.md"
            done = open_dir / "0008-soda-8.md"
            pending.write_text(issue_md("SODA-7"), encoding="utf-8")
            done.write_text(
                issue_md("SODA-8", "0008") + "\n## Linear comments\n\n_No Linear comments._\n",
                encoding="utf-8",
            )
            found = self.comments.collect_pending(root, ["open"])
            self.assertEqual([item[1] for item in found], ["SODA-7"])
            self.assertEqual(found[0][0].resolve(), pending.resolve())


if __name__ == "__main__":
    unittest.main()
