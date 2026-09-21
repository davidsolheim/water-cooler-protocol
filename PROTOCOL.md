# Water Cooler Protocol

WCP coordinates many coding agents on one shared local `dev` checkout. It is a seating chart for who may write which file right now, plus rules so agents treat drift as other workers rather than corruption.

Home: [watercoolerprotocol.com](https://watercoolerprotocol.com)

Scratch dir: `.WCP/` (gitignored, never shipped, never committed)

## Place in the Git loop

```
local dev          agents + you build here; WCP lives only here
    ↓ you check
origin/dev         your export after review
    ↓ PR
origin/main        product
```

Agents do not push `origin/dev`. They do not reset HEAD. They do not rewind the tree because another agent touched a file.

## Layers

| Layer | What exists | When |
|---|---|---|
| L0 Honor | Skill + `.WCP/RUN.md` as a human view | Skill still moving; not the store |
| L1 Referee | Skill + `wcpd` + local SQLite | V1. Board must be true |
| L2 Gate | L1 + `write_ok` + local git hooks | Writes without a lease fail the check; agents cannot push |

Same protocol at every layer. Thicker walls.

V1 implements L1 fully. L2 is `write_ok` plus git hooks. Harness-level wrapping of editor write tools is later.

## Actors

A human starts a run and sets `arch` (the session’s architectural aim). N developer agents, each with a short id (`auth-1`, `ui-2`) and their own instructions. The board holds occupancy only.

## Lease

A lease is an edit burst, not a task.

- Acquire immediately before a write.
- Release the instant the write is on disk — before tests, thinking, or waiting.
- Failed tests → `look` → acquire again (a new acquire, not a held lease).
- `reup` extends `expires_at` only while still flushing that burst.
- Idle leases are a violation. One live path per agent. One agent per path.
- Default TTL: 60 seconds.

## Tests first, not on the board

Each agent writes or appends their tests before taking implementation. A one-line comment on the test states what it proves and points at `arch`:

```
// WCP auth-1: refresh cookie rotates on session mint (arch)
```

Never delete someone else’s tests. Never hollow a test to make your slice green. During a run, execute **your** tests. Mid-run red often means another agent is mid-edit; do not “fix” their source to pass yours. Full green is the human’s gate before `origin/dev`.

Prefer per-slice test files so shared tests do not serialize like barrels.

## Overtake

If you need a leased path and the lease is **expired or the recorded pid is dead**, you may take it — only to finish the work already in motion. Inherit `doing` and `scope`. Set `from_agent`. Do not revert their hunks. Do not swap designs.

If the work is wrong, do not overtake. Start a new lease after `arch` or the human says so.

## Barrels

Lockfiles, generated clients, root schema: still exclusive (every path is). Short leases still serialize them. `.WCP/barrels` is a glob list the skill treats as extra-hot. It is not a second lock type.

## Drift

Re-read the board and the real file before every write. On acquire, store `sha256` of the path (`MISSING` if the file does not exist). If disk ≠ snapshot: `drift`. Change outside your scope: leave it. Change inside your scope: stop, look, wait or retarget. Never rewind the repo.

## Store

`.WCP/run.sqlite` — local file, WAL, `busy_timeout=5000`. Not Prisma, not Turso, not Postgres. Two tables. Raw SQL. The daemon is the only client.

```sql
CREATE TABLE run (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  branch TEXT NOT NULL DEFAULT 'dev',
  arch TEXT NOT NULL DEFAULT '',
  ttl_sec INTEGER NOT NULL DEFAULT 60,
  created_at TEXT NOT NULL
);

CREATE TABLE live (
  agent_id TEXT NOT NULL PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  doing TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  from_agent TEXT,
  leased_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  pid INTEGER
);
```

One run row. `arch` is the aim of the session. One live row per agent, one per path. `UNIQUE(path)` is the exclusive lease. Timestamps are ISO-8601 UTC. No test text, no source, no chat.

`.WCP/RUN.md` is a rendered view of `look`. Humans glance. Agents call RPC.

`.WCP/mode` is `referee` in V1.

## Process

`wcpd` — one process per checkout. Not a hosted product. Not multi-tenant.

```
agents ── look / acquire / release / overtake / write_ok ──► wcpd ──► run.sqlite
                                                               └── .WCP/wcp.sock
```

- Bind: Unix socket `.WCP/wcp.sock`
- Trust: if you can write the checkout, you can talk to the socket
- Life: start with the run; CLI auto-starts the daemon; `wcp stop` exits it
- Singleton: exclusive lock `.WCP/wcpd.lock`; stale socket unlinked if the lock is free
- Clients: MCP tools or `wcp`. Agents do not open SQLite.

`look` does not reap: expired rows stay visible so `overtake` can inherit `doing`/`scope`. `reap` drops idle rows. Idle means `expires_at` has passed, or a recorded `pid` is dead.

`pid` is for long-lived clients (MCP). The one-shot CLI does not send `pid` — each invoke would look dead immediately. TTL is the idle clock for CLI bursts.

### RPC

Newline-delimited JSON on the socket.

| Call | Result |
|---|---|
| `look` | `{ arch, branch, ttl_sec, now, live[] }` (`drift` on each live row) |
| `start` | session row; does not wipe live unless `force` |
| `stop` | all live rows gone, daemon exits |
| `set_arch` | session aim; `{ human: true }` required |
| `acquire { agent, path, doing, scope?, pid? }` | row inserted, or `conflict` / `agent_busy` + existing row |
| `release { agent }` | row gone |
| `reup { agent }` | `expires_at` += ttl if this agent holds an unexpired row |
| `overtake { agent, path }` | `not_idle` if live; else inherit intent, set `from_agent` |
| `write_ok { agent, path }` | ok, or `no_lease` / `wrong_path` / `expired` / `drift` / `wrong_branch` / `no_run` |
| `reap` | `{ released }` |

`write_ok` order: run exists; `HEAD` == `run.branch`; agent holds `path`; lease not expired; disk sha == snapshot (or both `MISSING`).

No `wait` RPC. On conflict: retarget, overtake if idle, or pick another path from `arch`.

`set_arch` is human-only. MCP does not expose it.

## A single agent turn

```
look
write/append tests + WCP comment     (acquire test path only while saving, then release)
look
acquire source
write-ok
re-read source from disk
edit, flush to disk
release
run your tests
if red → look → acquire → write-ok → edit → release → run again
```

At a healthy N, `live` should be almost empty most of the time. A long live list means people are camping through tests.

## What this system is not

- **Not Git.** Commits, `origin/dev`, and the PR to main stay yours.
- **Not Watercooler** (threads + ball-passing). Occupancy ≠ conversation.
- **Not worktrees.** Those isolate checkouts. WCP keeps everyone on one live `dev`.
- **Not a place for test plans, review notes, or source snapshots.**
- **Not Turso/Prisma/Neon.** The board is a mutex with a few strings.

## Failure modes the system accepts

- Barrel files still serialize.
- Honor system will be ignored by some models; L1/L2 exist for that.
- You remain the gate before `origin/dev`. WCP keeps agents from eating each other. It does not review the pile.
- Shell bypass of editor tools can still write without `write_ok`. V1 does not revert those writes (revert is rewind).
- Operating point is 8–20 writers on disjoint files, not 100.

## Paths

Repo root is `git rev-parse --show-toplevel`. WCP refuses to run outside a git checkout. Board paths are relative to that root, POSIX, no `..`, no leading `./`, no absolutes.

Agent ids match `^[a-z0-9][a-z0-9._:-]{0,63}$`.
