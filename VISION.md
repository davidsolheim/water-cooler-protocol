# Water Cooler Protocol

A seating chart for who may write which file right now, on one shared local `dev` checkout.

It is not Git, not a chat system, not a test runner, and not [Watercooler](https://github.com/mostlyharmless-ai/watercooler) (threads + ball-passing). Occupancy is not conversation.

Home: [watercoolerprotocol.com](https://watercoolerprotocol.com)

## V1

Local referee for 8–20 coding agents on one dirty working tree:

- `wcpd` + SQLite stay gitignored under `.wcp/`; the work queue in `.wcp/issues/` is committed
- Burst TTL leases (default 60s), one path per agent, one agent per path
- Claims only for files that existed when the run started. Tests are written first and are not claimed. New files are written directly.
- Drift via sha256 at acquire
- CLI + MCP
- Agents name themselves (`wcp name`); the referee reserves the id
- Agent skill with a conflict playbook
- Git hooks: no board or sqlite commits; `.wcp/issues/` may be committed; agents (`WCP_AGENT`) cannot push
- The orchestrator is the only agent who commits, and only when no source-file lease is live. Workers do not commit or stash.

Humans still own `origin/dev` and main. Agents do not push, reset HEAD, or rewind sibling edits.

## Later

- watercoolerprotocol.com as a protocol page
- Harness-level refuse of editor write tools without a lease
- `watch` so agents are not polling `look`
- Honor-mode markdown as a debug view writer (never as the store)
