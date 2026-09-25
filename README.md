# Water Cooler Protocol

Occupancy leases for many coding agents on **one** shared local `dev` checkout.

WCP is a seating chart for who may write which file right now. It is not Git, not a chat system, not a test runner, and not [Watercooler](https://github.com/mostlyharmless-ai/watercooler) (threads + ball-passing). Occupancy is not conversation.

Home: [watercoolerprotocol.com](https://watercoolerprotocol.com)

Spec: [`PROTOCOL.md`](PROTOCOL.md)

## Place in the Git loop

```
local dev          agents + you; the board stays here, issues commit with the branch
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

That starts `wcpd` (unix socket `.WCP/wcp.sock`, SQLite `.WCP/run.sqlite`), writes `.WCP/RUN.md` for humans, and installs **local** git hooks (not `core.hooksPath`). Gitignore is occupancy only:

```
.WCP/RUN.md
.WCP/run.sqlite
.WCP/*.sqlite-wal
.WCP/*.sqlite-shm
```

A blanket `.WCP/` line is removed so `.WCP/issues/` can be committed. Hooks still reject every other `.WCP/` path. Agents do not push.

Each agent names itself. It does not wait for a human to assign the id.

```bash
wcp name session-refresh --json
export WCP_AGENT=session-refresh
export WCP_NAME_TOKEN=<token from the result>
```

A taken name returns `name_taken`. Pick another id. Do not rename after the token is exported.

```bash
wcp look --json
# write the test first. do not claim it.
# // WCP auth-1: src/auth/session.ts refresh cookie rotates on session mint (arch)
wcp acquire --path src/auth/session.ts --test src/auth/session.test.ts --doing "rotate refresh cookie" --scope rotateRefreshToken
wcp write-ok --path src/auth/session.ts
# edit, flush
wcp release
```

A file that was not in the tree when the run started is written directly. No `acquire`, no `write-ok`. A test file is the same.

Conflict: read the existing row. Same intent and idle → `wcp overtake --path … --test …` only to finish that work, after your own test names the path. Otherwise retarget. Do not busy-loop `look`.

Load the skill [`skill/water-cooler-protocol/SKILL.md`](skill/water-cooler-protocol/SKILL.md) and paste [`skill/AGENTS.snippet.md`](skill/AGENTS.snippet.md) into the app's `AGENTS.md`.

MCP (stdio):

```json
{ "command": "wcp", "args": ["mcp"] }
```

## What V1 is

- Exclusive **file** leases for files that existed at `wcp init`, one path per agent, 60s burst TTL
- Tests written before the claim, and never claimed. New files written with no claim
- Drift via sha256 at acquire (`write-ok` fails if the file moved)
- `overtake` inherits `doing`/`scope` on idle leases
- L2: `write-ok` + hooks (no board or sqlite commits; `.WCP/issues/` is committed; `WCP_AGENT` cannot push)
- Committed queue: `.WCP/issues/{open,in-progress,in-review,done,canceled,blocked}/`. Ticket lease is 10 minutes. A solver moves finished work to `in-review/`. One reviewer per issue checks it, fixes it, and sets `done`. Cancel and block each write `reason` and stay searchable. File lease stays the floor TTL. `RUN.md` stays occupancy and `arch`
- Operating point: about 8–20 writers on disjoint files, not 100

Not in V1: honor-mode markdown as the store, multi-path `also` bursts, harness wrapping of editor write tools, a hosted referee.

## License

MIT © David Solheim
