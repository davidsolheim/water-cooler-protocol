## wcp

This checkout may have many coding agents on one local `dev` working tree. The issue files are the protocol. There is no daemon.

- Skill: `water-cooler-protocol`
- Spec: `PROTOCOL.md`
- `in-progress/` means an agent is editing that issue on this machine. Read those files and work around the paths they list.
- If you edit a file that already has uncommitted changes, read the `in-progress/` or `done/` issue that lists that path, and the other paths in its `files`. Keep the behavior its `acceptance` describes.
- Move your issue to `done/` when the writing is finished. Do not commit while any issue is in `in-progress/`.
- When `in-progress/` is empty and you have no further task, commit, push `dev` to `origin/dev`, and move those `done/` issues to `deployed-dev/`.
- `deployed-main/` is only for a commit that is on `origin/main`.
- Commit `.wcp/issues/` and `.wcp/tracker.md`. Do not commit any other path under `.wcp/`. Do not reset, checkout, or stash another agent's work.
- External tracking is optional. Read `.wcp/tracker.md`. `none` or a missing file means wcp only. A named tracker (`notion`, `linear`, `jira`, or another) gets the same updates after each file write.
