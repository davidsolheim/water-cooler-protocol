## Water Cooler Protocol

This checkout may have many coding agents on one local `dev` working tree.

- Skill: `water-cooler-protocol` (load it for every session in this repo)
- Start a run: `wcp init --arch "<aim of this session>" --branch dev`
- Each agent names itself with `wcp name <id>` and exports `WCP_AGENT` and `WCP_NAME_TOKEN`. It does not wait for a human to assign the id
- Agents write tests and new files directly. They `wcp acquire` only a file that already existed, and only after a test names it. They do not push, reset HEAD, or rewind sibling edits
- Occupancy (`.wcp/RUN.md`, `.wcp/run.sqlite`, wal, shm) is gitignored. Do not commit it. Commit `.wcp/issues/`. If the checkout has `.WCP/` and no `.wcp/`, that legacy folder is the queue. Do not rename it during a run.
- Only the orchestrator runs `git commit`, and only when `wcp look` shows no live source-file lease. Workers do not commit or stash.
- On start, read `.wcp/issues/open`, `in-progress`, and `in-review`. Reclaim expired `in-progress` tickets. Do not reclaim `in-review`. Do not copy the backlog onto `RUN.md`. Load the skill for claim, renew, close, cancel, and block. Search `canceled/` and `blocked/` before filing the same work again
