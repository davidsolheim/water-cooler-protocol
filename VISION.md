# Water Cooler Protocol

A seating chart for who may write which file right now, on one shared local `dev` checkout.

It is not Git, not a chat system, not a test runner, and not [Watercooler](https://github.com/mostlyharmless-ai/watercooler) (threads + ball-passing). Occupancy is not conversation.

Home: [watercoolerprotocol.com](https://watercoolerprotocol.com)

## V1

Local referee for 8–20 coding agents on one dirty working tree:

- `wcpd` + SQLite in gitignored `.WCP/`
- Burst TTL leases (default 60s), one path per agent, one agent per path
- Drift via sha256 at acquire
- CLI + MCP
- Agent skill with a conflict playbook
- Git hooks: no `.WCP/` commits; agents (`WCP_AGENT`) cannot push

Humans still own `origin/dev` and main. Agents do not push, reset HEAD, or rewind sibling edits.

## Later

- watercoolerprotocol.com as a protocol page
- Harness-level refuse of editor write tools without a lease
- `watch` so agents are not polling `look`
- Honor-mode markdown as a debug view writer (never as the store)
