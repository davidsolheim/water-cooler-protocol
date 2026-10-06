---
id: 0001
title: Stamp issue files and archive done and canceled by day
status: done
priority: high
assignee: queue-layout
lease_expires:
scope: PROTOCOL.md, the player skill, the issue path helper, and the linear importer's new-file paths
acceptance: A new issue file is stamped from created, hot folders stay flat, and done and canceled use the filing day. The issue file is the record. Notion is a later copy.
files:
  - PROTOCOL.md
  - README.md
  - skill/AGENTS.snippet.md
  - skill/water-cooler-protocol/SKILL.md
  - src/issues.ts
  - test/issues.test.ts
  - scripts/linear-import/wcp_paths.py
  - scripts/linear-import/import-linear-to-wcp.py
  - scripts/linear-import/import-linear-comments.py
  - scripts/linear-import/test_linear_import.py
  - scripts/linear-import/README.md
commit:
pr:
reason:
created: 2026-10-01T12:22:27Z
session: 2026-10-01T12:22:27Z
notion_page_id:
notion_url:
---

The issue file is the record for a session. File at least one before the work. File a separate file for each change that can be claimed, reviewed, and shipped on its own. Share `session`. Do not make a parent issue.

`open/`, `in-progress/`, `in-review/`, and `blocked/` stay flat. New `done/` and `canceled/` files go under `YYYY/MM/DD` from `created`. The filename is `YYYYMMDDThhmmZ-<id>-<slug>.md` and stays the same when the status moves.

Notion is copied after the file write. A failed copy leaves the file as the record. A later resync walks the hot folders whole and the archives by day.
