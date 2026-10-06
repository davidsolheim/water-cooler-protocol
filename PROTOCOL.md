# wcp

Many coding agents share one local `dev` checkout. The issue files under `.wcp/issues/` are the whole protocol. There is no daemon, no database, and no lease command.

Home: [watercoolerprotocol.com](https://watercoolerprotocol.com)

## Folders

```
.wcp/issues/
  open/                          backlog. does not block a commit
  in-progress/                   an agent is editing this, on this machine
  done/YYYY/MM/DD/               writing is finished. the code is in the tree. not pushed
  deployed-dev/YYYY/MM/DD/       the commit is on origin/dev
  deployed-main/YYYY/MM/DD/      the commit is on origin/main
  blocked/                       still wanted. do not pick it up. reason is set
  canceled/YYYY/MM/DD/           will not be done. reason is set
```

`open/`, `in-progress/`, and `blocked/` stay flat. `done/`, `deployed-dev/`, `deployed-main/`, and `canceled/` go under `YYYY/MM/DD` from `created`. Walk every `*.md` under a status directory, including a day tree and any older flat file.

The filename is `YYYYMMDDThhmmZ-<id>-<slug>.md`. A move keeps that filename. Set `status` to the folder name, then move the file.

An issue left in `in-review/` is finished writing. Move it to `done/`.

## The run

1. At the start, look in `done/`. If that issue's commit is already on `origin/dev`, move it to `deployed-dev/` and write the sha in `dev`. If it is already on `origin/main`, move it to `deployed-main/` and write the sha in `main`. Then read `in-progress/`.
2. Take one issue from `open/` whose `files` do not overlap an issue already in `in-progress/`. Move it to `in-progress/`. Write your name in `assignee`. Read it back. If `assignee` is not you, stop.
3. Add each path to `files` as you write it. Another agent reads `in-progress/` and works around those paths.
4. When the writing matches `acceptance`, move the issue to `done/`.
5. If `in-progress/` still has anything, or you still have another task, stop. Do not commit. Do not push. Leave the tree dirty.
6. If `in-progress/` is empty and you have no further task, commit the tree, push `dev` to `origin/dev`, write that sha into `dev` on each `done/` issue from that commit, and move those issues to `deployed-dev/`.
7. A later run's start check moves an issue to `deployed-main/` only after its commit is on `origin/main`, and writes that sha into `main`.

`open/` does not block the push. Only `in-progress/` means someone is still editing.

Do not commit while any issue is in `in-progress/`. Do not reset, checkout, or stash. Another agent's uncommitted work stays.

If you edit a file that already has uncommitted changes, find every issue in `in-progress/` or `done/` whose `files` list includes that path. Read that issue and the other paths in its `files`. Keep the behavior its `acceptance` describes. Your edit builds on those changes. Do not revert them, and do not leave that acceptance broken.

A crashed agent leaves an issue in `in-progress/`. The next agent moves it back to `open/` when the work has stopped, and clears `assignee`.

## Issue file

```yaml
---
id: 0123
title: Rotate refresh token on session mint
status: open
assignee:
files: []
acceptance:
reason:
dev:
main:
created: 2026-10-01T12:02:00Z
session: 2026-10-01T12:00:00Z
---
```

The body under the frontmatter is the spec. `dev` and `main` stay empty until those commits exist. `reason` is required to block or cancel.

Search `blocked/` and `canceled/` before filing the same work again. Read `reason`. Unblocking moves the file to `open/` and leaves `reason`. Reviving a canceled issue does the same, and only when the user says to.

Commit `.wcp/issues/` and `.wcp/tracker.md`. Do not commit any other path under `.wcp/`.

## External tracker

wcp issues are always created and managed in `.wcp/issues/`. An external tracker is optional.

The choice lives in `.wcp/tracker.md`:

```yaml
---
tracker: none
url:
---
```

`tracker` is `none`, or a tool the user named: `notion`, `linear`, `jira`, or another. `url` is that board or project. `none` leaves `url` empty.

Ask the user once when this file is missing. `none` is a complete answer. Record it and do not ask again. If you cannot ask, leave the file missing and keep going. A missing file means wcp only.

When `tracker` is not `none`, every create, status move, `files` change, and `dev` or `main` sha is written to that tool as well. The file is written first. A failed external write does not undo the file. Do not create a second queue.
