#!/usr/bin/env python3
"""Unit tests for Linear import path resolution, --force replacement, allowlists, and comment batching.

# WCP prb-fix: scripts/linear-import/import-linear-to-wcp.py --force replaces stale linear_id files (fix linear-import)
# WCP prb-fix: scripts/linear-import/import-linear-comments.py folder/id allowlist and batched comments query (fix linear-import)
# WCP prb-fix: scripts/linear-import/import-linear-comments.py aliased issue(id:) batch, not IssueFilter.identifier (fix linear-import)
# WCP prb-fix: scripts/linear-import/import-linear-comments.py --teams prefix filter skips planted HR-1 (fix linear-import)
# WCP prb-fix: scripts/linear-import/import-linear-to-wcp.py require identifier and unlink symlink dest (fix linear-import)
# WCP prb-fix: scripts/linear-import/apply-notion-ids.py resolve issues root like wcpDirName (fix linear-import)
# WCP prb-fix: scripts/linear-import/build-notion-batches.py resolve issues root like wcpDirName (fix linear-import)
# WCP prb-fix: scripts/linear-import/fix-wcp-acceptance.py resolve issues root like wcpDirName (fix linear-import)
# WCP prb-fix: scripts/linear-import/import-linear-comments.py collect_pending skips files with no linear_id (fix linear-import)
# WCP prb-fix: scripts/linear-import/import-linear-comments.py graphql keeps data when errors also present (fix linear-import)
# WCP prb-fix: scripts/linear-import/apply-notion-ids.py unlink dest symlink before write (fix linear-import)
# WCP prb-fix: scripts/linear-import/fix-wcp-acceptance.py unlink dest symlink before write (fix linear-import)
"""

from __future__ import annotations

import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
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
    write_under_issues,
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
    def test_entries_refuse_when_both_exist(self) -> None:
        with self.assertRaises(ValueError) as caught:
            wcp_dir_name_from_entries([".wcp", ".WCP", "src"])
        self.assertIn("both .wcp/ and .WCP/", str(caught.exception))
        self.assertIn("nests a tree", str(caught.exception))

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

    def test_filename_for_requires_linear_identifier(self) -> None:
        name = self.importer.filename_for(
            {"identifier": "SODA-7", "title": "Short title"}, "0007"
        )
        self.assertEqual(name, "0007-soda-7-short-title.md")
        for bad in ("SODA-7/../../etc", "../SODA-7", "soda-7", "SODA-7\nENG-1"):
            with self.assertRaises(ValueError):
                self.importer.filename_for({"identifier": bad, "title": "x"}, "0007")

    def test_symlink_dest_is_replaced_by_regular_file_inside_issues(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            issues = root / ".wcp" / "issues"
            dest = issues / "open" / "0007-soda-7-short-title.md"
            dest.parent.mkdir(parents=True)
            outside = root / "outside-target.md"
            outside.write_text("keep me\n", encoding="utf-8")
            dest.symlink_to(outside)
            self.assertTrue(dest.is_symlink())
            self.importer.replace_issue_file(
                issues, dest, issue_md("SODA-7", extra=" imported"), "SODA-7"
            )
            self.assertTrue(dest.exists())
            self.assertFalse(dest.is_symlink())
            self.assertTrue(dest.is_file())
            self.assertEqual(dest.resolve().parent, (issues / "open").resolve())
            self.assertTrue(dest.resolve().is_relative_to(issues.resolve()))
            self.assertIn("imported", dest.read_text(encoding="utf-8"))
            self.assertEqual(outside.read_text(encoding="utf-8"), "keep me\n")
            self.assertFalse(outside.is_symlink())

    def test_replace_issue_file_does_not_follow_a_temp_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            issues = root / ".wcp" / "issues"
            dest = issues / "open" / "0007-soda-7-short-title.md"
            dest.parent.mkdir(parents=True)
            outside = root / "outside-target.md"
            outside.write_text("keep me\n", encoding="utf-8")
            temporary = dest.with_name(dest.name + ".wcp-tmp")
            temporary.symlink_to(outside)
            self.importer.replace_issue_file(
                issues, dest, issue_md("SODA-7", extra=" imported"), "SODA-7"
            )
            self.assertEqual(outside.read_text(encoding="utf-8"), "keep me\n")
            self.assertFalse(outside.is_symlink())
            self.assertTrue(dest.is_file())
            self.assertFalse(dest.is_symlink())
            self.assertIn("imported", dest.read_text(encoding="utf-8"))
            self.assertFalse(temporary.exists())


class DestSymlinkWriteTests(unittest.TestCase):
    def _symlink_dest(self, tmp: str, outside_text: str) -> tuple[Path, Path, Path]:
        root = Path(tmp)
        issues = root / ".wcp" / "issues"
        dest = issues / "open" / "0007-soda-7-short-title.md"
        dest.parent.mkdir(parents=True)
        outside = root / "outside-target.md"
        outside.write_text(outside_text, encoding="utf-8")
        dest.symlink_to(outside)
        return issues, dest, outside

    def test_write_under_issues_leaves_outside_symlink_target_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            issues, dest, outside = self._symlink_dest(tmp, "keep me\n")
            self.assertTrue(dest.is_symlink())
            written = write_under_issues(issues, dest, issue_md("SODA-7", extra=" written"))
            self.assertTrue(dest.exists())
            self.assertFalse(dest.is_symlink())
            self.assertTrue(dest.is_file())
            self.assertEqual(dest.resolve().parent, (issues / "open").resolve())
            self.assertTrue(dest.resolve().is_relative_to(issues.resolve()))
            self.assertIn("written", dest.read_text(encoding="utf-8"))
            self.assertEqual(outside.read_text(encoding="utf-8"), "keep me\n")
            self.assertFalse(outside.is_symlink())
            self.assertEqual(written.resolve(), dest.resolve())

    def test_apply_notion_ids_leaves_outside_symlink_target_unchanged(self) -> None:
        apply = load_script("apply-notion-ids.py")
        original = (
            "---\n"
            'id: "0007"\n'
            'linear_id: "SODA-7"\n'
            "status: open\n"
            "notion_page_id:\n"
            "notion_url:\n"
            "---\n\n"
            "body\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            issues, dest, outside = self._symlink_dest(tmp, original)
            self.assertTrue(apply.fill_notion_ids(issues, dest, "page-1", "https://notion.example/p"))
            self.assertFalse(dest.is_symlink())
            self.assertIn("page-1", dest.read_text(encoding="utf-8"))
            self.assertEqual(outside.read_text(encoding="utf-8"), original)

    def test_queue_by_id_matches_quoted_and_unquoted_ids(self) -> None:
        apply = load_script("apply-notion-ids.py")
        batches = load_script("build-notion-batches.py")
        quoted = (
            "---\n"
            'id: "0007"\n'
            "status: open\n"
            "notion_page_id:\n"
            "notion_url:\n"
            "---\n\n"
            "imported\n"
        )
        native = (
            "---\n"
            "id: 0123\n"
            "status: open\n"
            "notion_page_id:\n"
            "notion_url:\n"
            "---\n\n"
            "native\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            issues = Path(tmp) / ".wcp" / "issues" / "open"
            issues.mkdir(parents=True)
            quoted_path = issues / "0007-soda-7.md"
            native_path = issues / "0123-native.md"
            quoted_path.write_text(quoted, encoding="utf-8")
            native_path.write_text(native, encoding="utf-8")
            by_id = apply.queue_by_id(issues.parent)
            self.assertEqual(by_id["0007"], quoted_path)
            self.assertEqual(by_id["0123"], native_path)
            self.assertEqual(batches.grab(native.split("---", 2)[1], "id"), "0123")
            self.assertEqual(apply.issue_id(native), "0123")
            self.assertTrue(
                apply.fill_notion_ids(issues.parent, native_path, "page-native", "https://notion.example/native")
            )
            written = native_path.read_text(encoding="utf-8")
            self.assertIn('notion_page_id: "page-native"', written)
            self.assertIn('notion_url: "https://notion.example/native"', written)
            self.assertEqual(apply.queue_by_id(issues.parent)["0123"], native_path)

    def test_fix_wcp_acceptance_leaves_outside_symlink_target_unchanged(self) -> None:
        fix = load_script("fix-wcp-acceptance.py")
        original = (
            "---\n"
            'id: "0007"\n'
            'linear_id: "SODA-7"\n'
            'acceptance: "Acceptance criteria"\n'
            "---\n\n"
            "## Summary\n\n"
            "This summary sentence is long enough to become the real acceptance line.\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            issues, dest, outside = self._symlink_dest(tmp, original)
            self.assertTrue(fix.rewrite_acceptance(issues, dest))
            self.assertFalse(dest.is_symlink())
            self.assertNotIn('acceptance: "Acceptance criteria"', dest.read_text(encoding="utf-8"))
            self.assertEqual(outside.read_text(encoding="utf-8"), original)

    def test_rewrite_acceptance_leaves_a_custom_definition(self) -> None:
        fix = load_script("fix-wcp-acceptance.py")
        original = (
            "---\n"
            'id: "0007"\n'
            'linear_id: "SODA-7"\n'
            'acceptance: "Rotate the refresh token and reject the old one."\n'
            "---\n\n"
            "## Summary\n\n"
            "This summary sentence is long enough to become the real acceptance line.\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            issues = Path(tmp) / ".wcp" / "issues" / "open"
            issues.mkdir(parents=True)
            dest = issues / "0007.md"
            dest.write_text(original, encoding="utf-8")
            self.assertFalse(fix.rewrite_acceptance(issues.parent, dest))
            self.assertEqual(dest.read_text(encoding="utf-8"), original)

    def test_rewrite_acceptance_replaces_a_summary_heading(self) -> None:
        fix = load_script("fix-wcp-acceptance.py")
        original = (
            "---\n"
            'id: "0007"\n'
            'linear_id: "SODA-7"\n'
            'acceptance: "Summary"\n'
            "---\n\n"
            "## Summary\n\n"
            "This summary sentence is long enough to become the real acceptance line.\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            issues = Path(tmp) / ".wcp" / "issues" / "open"
            issues.mkdir(parents=True)
            dest = issues / "0007.md"
            dest.write_text(original, encoding="utf-8")
            self.assertTrue(fix.rewrite_acceptance(issues.parent, dest))
            written = dest.read_text(encoding="utf-8")
            self.assertIn(
                "This summary sentence is long enough to become the real acceptance line.",
                written,
            )
            self.assertNotIn('acceptance: "Summary"', written)

    def test_rewrite_acceptance_replaces_other_heading_placeholders(self) -> None:
        fix = load_script("fix-wcp-acceptance.py")
        sentence = "The description sentence is long enough to replace a heading-only acceptance."
        for heading in ("Description", "Problem", "Current behavior"):
            original = (
                "---\n"
                'id: "0007"\n'
                'linear_id: "SODA-7"\n'
                f'acceptance: "{heading}"\n'
                "---\n\n"
                f"## {heading}\n\n"
                f"{sentence}\n"
            )
            with tempfile.TemporaryDirectory() as tmp:
                issues = Path(tmp) / ".wcp" / "issues" / "open"
                issues.mkdir(parents=True)
                dest = issues / "0007.md"
                dest.write_text(original, encoding="utf-8")
                self.assertTrue(fix.rewrite_acceptance(issues.parent, dest), heading)
                written = dest.read_text(encoding="utf-8")
                self.assertNotIn(f'acceptance: "{heading}"', written)


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

    def test_parse_linear_id_ignores_a_body_line(self) -> None:
        text = issue_md("SODA-7") + '\nlinear_id: "HR-1"\n'
        self.assertEqual(parse_linear_id(text), "SODA-7")

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

    def test_batch_request_uses_aliased_issue_id_not_identifier_filter(self) -> None:
        ids = ["SODA-1", "SODA-2"]
        payload = self.comments.comments_batch_payload(ids)
        query = " ".join(payload["query"].split())
        self.assertEqual(payload["variables"], {"id0": "SODA-1", "id1": "SODA-2"})
        self.assertIn("query($id0: String!, $id1: String!)", query)
        self.assertIn("i0: issue(id: $id0)", query)
        self.assertIn("i1: issue(id: $id1)", query)
        self.assertIn("comments(first: 50)", query)
        self.assertIn("pageInfo { hasNextPage }", query)
        self.assertIn("nodes { body createdAt user { name } }", query)
        self.assertNotIn("identifier: { in", query)
        self.assertNotIn("$ids", query)
        self.assertNotIn("filter:", query)
        self.assertNotIn("issues(", query)
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
                issue_md("SODA-8", "0008").replace(
                    "status: open\n",
                    "status: open\nlinear_comments: fetched\n",
                ),
                encoding="utf-8",
            )
            described = open_dir / "0009-soda-9.md"
            described.write_text(
                issue_md("SODA-9", "0009") + "\n## Linear comments\n\nCopied from the Linear description.\n",
                encoding="utf-8",
            )
            found = self.comments.collect_pending(root, ["open"], ["SODA"])
            self.assertEqual([item[1] for item in found], ["SODA-7", "SODA-9"])
            self.assertEqual(found[0][0].resolve(), pending.resolve())

    def test_parse_team_keys_requires_at_least_one(self) -> None:
        self.assertEqual(self.comments.parse_team_keys("SODA"), ["SODA"])
        self.assertEqual(self.comments.parse_team_keys("SODA,TW"), ["SODA", "TW"])
        for raw in ("", " , ,"):
            with self.assertRaises(ValueError):
                self.comments.parse_team_keys(raw)

    def test_collect_pending_skips_planted_hr_when_teams_soda(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / ".wcp" / "issues"
            open_dir = root / "open"
            open_dir.mkdir(parents=True)
            soda = open_dir / "0007-soda-7.md"
            planted = open_dir / "0001-hr-1.md"
            soda.write_text(issue_md("SODA-7"), encoding="utf-8")
            planted.write_text(issue_md("HR-1", "0001"), encoding="utf-8")
            found = self.comments.collect_pending(root, ["open"], ["SODA"])
            self.assertEqual([item[1] for item in found], ["SODA-7"])
            payload = self.comments.comments_batch_payload([item[1] for item in found])
            self.assertEqual(list(payload["variables"].values()), ["SODA-7"])
            self.assertNotIn("HR-1", payload["variables"].values())
            self.assertNotIn("HR-1", payload["query"])

    def test_fetch_comments_does_not_request_planted_hr_id(self) -> None:
        calls: list[dict] = []

        def fake_graphql(_token: str, payload: dict) -> dict:
            calls.append(payload)
            return {
                "i0": {
                    "identifier": "SODA-7",
                    "comments": {"pageInfo": {"hasNextPage": False}, "nodes": []},
                }
            }

        original = self.comments.graphql
        self.comments.graphql = fake_graphql
        try:
            found = self.comments.fetch_comments_for_ids(
                "token", ["SODA-7", "HR-1"], ["SODA"]
            )
        finally:
            self.comments.graphql = original
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["variables"], {"id0": "SODA-7"})
        query = " ".join(calls[0]["query"].split())
        self.assertIn("i0: issue(id: $id0)", query)
        self.assertNotIn("HR-1", calls[0]["variables"].values())
        self.assertNotIn("HR-1", query)
        self.assertNotIn("identifier: { in", query)
        self.assertIn("SODA-7", found)
        self.assertNotIn("HR-1", found)

    def test_collect_pending_skips_native_tickets_without_linear_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / ".wcp" / "issues"
            open_dir = root / "open"
            open_dir.mkdir(parents=True)
            soda = open_dir / "0001-soda-1.md"
            native = open_dir / "0002-native.md"
            soda.write_text(issue_md("SODA-1", "0001"), encoding="utf-8")
            native.write_text(
                '---\nid: "0002"\nstatus: open\n---\n\nbody\n',
                encoding="utf-8",
            )
            found = self.comments.collect_pending(root, ["open"], ["SODA"])
            self.assertEqual([item[1] for item in found], ["SODA-1"])
            self.assertEqual(found[0][0].resolve(), soda.resolve())

    def test_collect_pending_records_malformed_linear_id_and_continues(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / ".wcp" / "issues"
            open_dir = root / "open"
            open_dir.mkdir(parents=True)
            soda = open_dir / "0001-soda-1.md"
            bad = open_dir / "0003-bad.md"
            soda.write_text(issue_md("SODA-1", "0001"), encoding="utf-8")
            bad.write_text(issue_md("not-an-id", "0003"), encoding="utf-8")
            errors: list[str] = []
            buf = io.StringIO()
            with redirect_stdout(buf):
                found = self.comments.collect_pending(root, ["open"], ["SODA"], errors)
            self.assertEqual([item[1] for item in found], ["SODA-1"])
            self.assertEqual(len(errors), 1)
            self.assertIn("0003-bad.md", errors[0])
            self.assertIn("FAILED 0003-bad.md", buf.getvalue())

    def test_graphql_data_keeps_data_when_errors_present(self) -> None:
        body = {
            "data": {
                "i0": None,
                "i1": {
                    "identifier": "SODA-2",
                    "comments": {"pageInfo": {"hasNextPage": False}, "nodes": []},
                },
            },
            "errors": [{"message": "Entity not found: Issue"}],
        }
        data = self.comments.graphql_data(body)
        self.assertIsNone(data["i0"])
        self.assertIsInstance(data["i1"], dict)
        with self.assertRaises(RuntimeError):
            self.comments.graphql_data({"errors": [{"message": "boom"}]})

    def test_fetch_comments_returns_only_resolved_aliases(self) -> None:
        def fake_graphql(_token: str, _payload: dict) -> dict:
            return {
                "i0": None,
                "i1": {
                    "identifier": "SODA-2",
                    "comments": {
                        "pageInfo": {"hasNextPage": False},
                        "nodes": [{"body": "hi", "createdAt": "", "user": {"name": "A"}}],
                    },
                },
            }

        original = self.comments.graphql
        self.comments.graphql = fake_graphql
        try:
            found = self.comments.fetch_comments_for_ids(
                "token", ["SODA-1", "SODA-2"], ["SODA"]
            )
        finally:
            self.comments.graphql = original
        self.assertEqual(list(found), ["SODA-2"])
        self.assertNotIn("SODA-1", found)
        self.assertEqual(found["SODA-2"]["nodes"][0]["body"], "hi")


class CodexFollowupTests(unittest.TestCase):
    def test_id_owned_by_other_flags_a_native_ticket(self) -> None:
        importer = load_script("import-linear-to-wcp.py")
        with tempfile.TemporaryDirectory() as tmp:
            issues = Path(tmp) / ".wcp" / "issues" / "open"
            issues.mkdir(parents=True)
            native = issues / "0007-native.md"
            native.write_text(
                "---\nid: 0007\nstatus: open\n---\n\nNative ticket.\n",
                encoding="utf-8",
            )
            self.assertEqual(
                importer.id_owned_by_other(issues.parent, "0007", "SODA-7"),
                native,
            )
            self.assertIsNone(importer.id_owned_by_other(issues.parent, "0008", "SODA-8"))

    def test_carry_notion_keeps_an_existing_page_id(self) -> None:
        importer = load_script("import-linear-to-wcp.py")
        with tempfile.TemporaryDirectory() as tmp:
            issues = Path(tmp) / ".wcp" / "issues" / "open"
            issues.mkdir(parents=True)
            (issues / "0007.md").write_text(
                '---\nid: "0007"\nlinear_id: "SODA-7"\nnotion_page_id: "page-7"\nnotion_url: "https://notion.example/7"\n---\n\n',
                encoding="utf-8",
            )
            fresh = '---\nnotion_page_id:\nnotion_url:\n---\n\n'
            carried = importer.carry_notion(fresh, issues.parent, "SODA-7")
            self.assertIn('notion_page_id: "page-7"', carried)
            self.assertIn('notion_url: "https://notion.example/7"', carried)

    def test_notion_filled_ignores_a_body_line(self) -> None:
        apply = load_script("apply-notion-ids.py")
        text = (
            "---\n"
            'id: "0007"\n'
            'linear_id: "SODA-7"\n'
            "notion_page_id:\n"
            "notion_url:\n"
            "---\n\n"
            'The description mentions notion_page_id: "already" and notion_url: "https://example.com".\n'
        )
        self.assertFalse(apply.notion_filled(text))

    def test_load_pages_reads_a_result_named_like_a_batch(self) -> None:
        apply = load_script("apply-notion-ids.py")
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            result = {
                "pages": [
                    {
                        "id": "page-1",
                        "url": "https://notion.example/1?foo=1",
                        "properties": {"WCP": "0007"},
                    }
                ]
            }
            request = {
                "tool_name": "notion-create-pages",
                "tool_input": {
                    "pages": [
                        {
                            "properties": {"WCP": "0008"},
                            "content": "request body",
                        }
                    ]
                },
            }
            (out / "batch-00.json").write_text(json.dumps(result), encoding="utf-8")
            (out / "batch-01.json").write_text(json.dumps(request), encoding="utf-8")
            (out / "index-00.json").write_text(
                json.dumps([{"linear": "SODA-7", "wcp": "0007", "path": "open/0007.md"}]),
                encoding="utf-8",
            )
            found = apply.load_pages([out])
            self.assertEqual(found, {"0007": ("page-1", "https://notion.example/1")})
            self.assertEqual(apply.load_pages([out / "batch-00.json"]), found)
            self.assertEqual(apply.load_pages([out / "batch-01.json"]), {})

    def test_fill_notion_ids_keeps_an_existing_page_id(self) -> None:
        apply = load_script("apply-notion-ids.py")
        original = (
            "---\n"
            'id: "0007"\n'
            'linear_id: "SODA-7"\n'
            'notion_page_id: "page-7"\n'
            "notion_url:\n"
            "---\n\n"
            "body\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            issues = Path(tmp) / ".wcp" / "issues" / "open"
            issues.mkdir(parents=True)
            dest = issues / "0007.md"
            dest.write_text(original, encoding="utf-8")
            self.assertTrue(
                apply.fill_notion_ids(issues.parent, dest, "other-page", "https://notion.example/7")
            )
            written = dest.read_text(encoding="utf-8")
            self.assertIn('notion_page_id: "page-7"', written)
            self.assertIn('notion_url: "https://notion.example/7"', written)
            self.assertNotIn("other-page", written)

    def test_include_in_batch_skips_native_tickets(self) -> None:
        batches = load_script("build-notion-batches.py")
        native = "id: 0123\nstatus: open\n"
        imported = 'id: "0007"\nlinear_id: "SODA-7"\nstatus: open\n'
        mirrored = 'id: "0008"\nlinear_id: "SODA-8"\nnotion_page_id: "page"\n'
        self.assertFalse(batches.include_in_batch(native))
        self.assertTrue(batches.include_in_batch(imported))
        self.assertFalse(batches.include_in_batch(mirrored))

    def test_clear_generated_batches_removes_stale_files(self) -> None:
        batches = load_script("build-notion-batches.py")
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / "batch-03.json").write_text("{}", encoding="utf-8")
            (out / "index-03.json").write_text("[]", encoding="utf-8")
            (out / "notes.txt").write_text("keep", encoding="utf-8")
            batches.clear_generated_batches(out)
            self.assertFalse((out / "batch-03.json").exists())
            self.assertFalse((out / "index-03.json").exists())
            self.assertEqual((out / "notes.txt").read_text(encoding="utf-8"), "keep")

    def test_primary_then_rest_keeps_ids_already_on_disk(self) -> None:
        importer = load_script("import-linear-to-wcp.py")

        def issue(identifier: str, team: str) -> dict:
            return {"identifier": identifier, "team": {"key": team}}

        fresh = [
            issue("SODA-1", "SODA"),
            issue("SODA-3", "SODA"),
            issue("ENG-2", "ENG"),
            issue("HR-1", "HR"),
        ]
        assigned, _notes = importer.assign_ids(fresh, ["SODA", "ENG", "HR"], "primary-then-rest")
        self.assertEqual(
            assigned,
            {"SODA-1": "0001", "SODA-3": "0003", "ENG-2": "0004", "HR-1": "0005"},
        )
        with tempfile.TemporaryDirectory() as tmp:
            issues = Path(tmp) / ".wcp" / "issues" / "open"
            issues.mkdir(parents=True)
            (issues / "0007-soda-7.md").write_text(
                '---\nid: "0007"\nlinear_id: "SODA-7"\n---\n\n',
                encoding="utf-8",
            )
            (issues / "0012-eng-3.md").write_text(
                '---\nid: "0012"\nlinear_id: "ENG-3"\n---\n\n',
                encoding="utf-8",
            )
            (issues / "0123-native.md").write_text(
                "---\nid: 0123\nstatus: open\n---\n\n",
                encoding="utf-8",
            )
            mapping, reserved = importer.queue_id_state(issues.parent)
            self.assertEqual(mapping, {"SODA-7": "0007", "ENG-3": "0012"})
            self.assertIn(7, reserved)
            self.assertIn(12, reserved)
            self.assertIn(123, reserved)
            found = [
                issue("SODA-7", "SODA"),
                issue("SODA-12", "SODA"),
                issue("ENG-3", "ENG"),
                issue("ENG-9", "ENG"),
            ]
            again, notes = importer.assign_ids(
                found, ["SODA", "ENG"], "primary-then-rest", mapping, reserved
            )
            self.assertEqual(again["SODA-7"], "0007")
            self.assertEqual(again["ENG-3"], "0012")
            self.assertEqual(again["SODA-12"], "0124")
            self.assertEqual(again["ENG-9"], "0125")
            self.assertIn("ENG-3 -> 0012", notes)
            self.assertIn("SODA-12 -> 0124", notes)

    def test_preserve_wcp_fields_keeps_lease_and_local_status(self) -> None:
        importer = load_script("import-linear-to-wcp.py")
        old = (
            "---\n"
            'id: "0007"\n'
            'title: "Old title"\n'
            "status: in-review\n"
            "priority: normal\n"
            "assignee: agent-1\n"
            "lease_expires: 2026-09-26T18:00:00Z\n"
            'scope: "old scope"\n'
            'acceptance: "Keep the local done definition."\n'
            "files:\n"
            "  - src/a.ts\n"
            "commit: abc123\n"
            'reason: "Held for review."\n'
            'linear_id: "SODA-7"\n'
            "---\n\n"
            "old body\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            issues = Path(tmp) / ".wcp" / "issues" / "in-review"
            issues.mkdir(parents=True)
            (issues / "0007-soda-7.md").write_text(old, encoding="utf-8")
            fresh = importer.render(
                {
                    "identifier": "SODA-7",
                    "title": "New title from Linear",
                    "description": "Updated Linear description for the forced import.",
                    "state": {"type": "unstarted", "name": "Todo"},
                    "priority": 2,
                },
                "0007",
                "open",
                "",
            )
            kept = importer.preserve_wcp_fields(fresh, issues.parent, "SODA-7")
            front = kept.split("---", 2)[1]
            self.assertIn("\nstatus: in-review\n", front)
            self.assertNotIn("\nstatus: open\n", front)
            self.assertIn("assignee: agent-1", kept)
            self.assertIn("lease_expires: 2026-09-26T18:00:00Z", kept)
            self.assertIn("  - src/a.ts", kept)
            self.assertIn("commit: abc123", kept)
            self.assertIn('reason: "Held for review."', kept)
            self.assertIn("New title from Linear", kept)
            self.assertEqual(importer.stored_status(issues.parent, "SODA-7"), "in-review")
            untouched = importer.preserve_wcp_fields(fresh, issues.parent, "SODA-8")
            self.assertEqual(untouched, fresh)

    def test_issues_root_rejects_a_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "repo"
            outside = Path(tmp) / "outside"
            outside.mkdir()
            (repo / ".wcp").mkdir(parents=True)
            (repo / ".wcp" / "issues").symlink_to(outside, target_is_directory=True)
            with self.assertRaises(ValueError):
                issues_root(repo)


if __name__ == "__main__":
    unittest.main()
