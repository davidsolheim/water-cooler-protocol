## Water Cooler Protocol

This checkout may have many coding agents on one local `dev` working tree.

- Skill: `water-cooler-protocol` (load it for every session in this repo)
- Start a run: `wcp init --arch "<aim of this session>" --branch dev`
- Each agent names itself with `wcp name <id>` and exports `WCP_AGENT` and `WCP_NAME_TOKEN`. It does not wait for a human to assign the id
- Agents write tests and new files directly. They `wcp acquire` only a file that already existed, and only after a test names it. The seat covers research between hunks. Heartbeat with `wcp reup` while you are in the file. It does not require a write. Release when you leave the file. Do not hold the seat through tests or across files. Takeover is 5 minutes with no write and no heartbeat, or a dead pid. Ticket reclaim stays 10 minutes. They do not push, reset HEAD, or rewind sibling edits
- Do not edit `.wcp/RUN.md`. Call `wcp`. `wcp look` is the observer view of every live seat. A human may poll it every 5 seconds on an active checkout. Five minutes is how long a quiet seat is protected, not how long a seat stays invisible.
- Occupancy (`.wcp/RUN.md`, `.wcp/run.sqlite`, wal, shm) is gitignored. Do not commit it. Commit `.wcp/issues/`. If the checkout has `.WCP/` and no `.wcp/`, that legacy folder is the queue. Do not rename it during a run.
- Only the orchestrator runs `git commit`, and only when `wcp look` shows no live source-file lease. Workers do not commit or stash.
- Every session task files at least one issue before the work. A separate change gets its own file. The filename is `YYYYMMDDThhmmZ-<id>-<slug>.md`. `created` and `session` are UTC. `open/`, `in-progress/`, `in-review/`, and `blocked/` stay flat. New `done/` and `canceled/` files go under `YYYY/MM/DD` from `created`. The issue file is the record. Notion is a later copy. If Notion fails, the file stands
- On start, read `.wcp/issues/open`, `in-progress`, and `in-review`, including every markdown file under them. Reclaim expired `in-progress` tickets. Do not reclaim `in-review`. Do not copy the backlog onto `RUN.md`. Load the skill for claim, renew, close, cancel, and block. Search `canceled/` and `blocked/` before filing the same work again
