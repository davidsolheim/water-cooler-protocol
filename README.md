# wcp

Many coding agents share one local `dev` checkout. The issue files under `.wcp/issues/` are the whole protocol. There is no daemon and no `wcp` binary.

Home: [watercoolerprotocol.com](https://watercoolerprotocol.com)

Spec: [`PROTOCOL.md`](PROTOCOL.md)

Player skill: [`skill/water-cooler-protocol/SKILL.md`](skill/water-cooler-protocol/SKILL.md)

## Folders

| Folder | Meaning |
| --- | --- |
| `open/` | Backlog. Does not block a commit. |
| `in-progress/` | An agent is editing this, on this machine. |
| `done/` | Writing is finished. The code is in the tree. Not pushed. |
| `deployed-dev/` | The commit is on `origin/dev`. |
| `deployed-main/` | The commit is on `origin/main`. |
| `blocked/` | Still wanted. Do not pick it up. |
| `canceled/` | Will not be done. |

An agent moves an issue from `open/` to `in-progress/`, lists the files it touches, and moves it to `done/` when the writing is finished. It does not commit while any issue is in `in-progress/`. The agent that finishes last, and has no further task, commits the tree and pushes `dev` to `origin/dev`, then moves those issues to `deployed-dev/`. A later run moves an issue to `deployed-main/` after that commit is on `origin/main`.

Commit `.wcp/issues/` and `.wcp/tracker.md`. Do not commit any other path under `.wcp/`.

An external tracker is optional. The user picks one in `.wcp/tracker.md` (`notion`, `linear`, `jira`, another tool, or `none`). wcp issues are always managed here. When a tool is named, the same updates are written there too. A missing file or `none` means this folder is the only queue.
