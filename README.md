# Water Cooler Protocol

Occupancy leases for many coding agents on **one** shared local `dev` checkout.

WCP is a seating chart for who may write which file right now. It is not Git, not a chat system, not a test runner, and not [Watercooler](https://github.com/mostlyharmless-ai/watercooler) (threads + ball-passing). Occupancy is not conversation.

Home: [watercoolerprotocol.com](https://watercoolerprotocol.com)

Spec: [`PROTOCOL.md`](PROTOCOL.md)

## Place in the Git loop

```
local dev          agents + you; WCP lives only here (.WCP/ is gitignored)
    ↓ you check
origin/dev         your export after review
    ↓ PR
origin/main        product
```

Agents do not push `origin/dev`. They do not reset HEAD. They do not rewind the tree because another agent touched a file.

## Install

Needs [Bun](https://bun.sh).

```bash
git clone https://github.com/davidsolheim/water-cooler-protocol
cd water-cooler-protocol
bun test
bun run build          # dist/wcp
```

Put `dist/wcp` on your `PATH`, or alias:

```bash
alias wcp='bun /path/to/water-cooler-protocol/src/cli.ts'
```

## Use in a checkout

```bash
cd /path/to/your/app
wcp init --arch "rotate refresh tokens on session mint; dashboard empty state; no schema migrate"
```

That starts `wcpd` (unix socket `.WCP/wcp.sock`, SQLite `.WCP/run.sqlite`), writes `.WCP/RUN.md` for humans, appends `.WCP/` to `.gitignore`, and installs **local** git hooks (not `core.hooksPath`).

Each agent, in its first prompt: `you are auth-1` and `export WCP_AGENT=auth-1`.

```bash
wcp look --json
wcp acquire --path src/auth/session.ts --doing "rotate refresh cookie" --scope rotateRefreshToken
wcp write-ok --path src/auth/session.ts
# edit, flush
wcp release
```

Conflict: read the existing row. Same intent and idle → `wcp overtake --path …` only to finish that work. Otherwise retarget. Do not busy-loop `look`.

Load the skill [`skill/water-cooler-protocol/SKILL.md`](skill/water-cooler-protocol/SKILL.md) and paste [`skill/AGENTS.snippet.md`](skill/AGENTS.snippet.md) into the app's `AGENTS.md`.

MCP (stdio):

```json
{ "command": "wcp", "args": ["mcp"] }
```

## What V1 is

- Exclusive **file** leases, one path per agent, 60s burst TTL
- Drift via sha256 at acquire (`write-ok` fails if the file moved)
- `overtake` inherits `doing`/`scope` on idle leases
- L2: `write-ok` + hooks (no `.WCP/` commits; `WCP_AGENT` cannot push)
- Operating point: about 8–20 writers on disjoint files, not 100

Not in V1: honor-mode markdown as the store, multi-path `also` bursts, harness wrapping of editor write tools, a hosted referee.

## License

MIT © David Solheim
