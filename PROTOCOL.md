# Water Cooler Protocol

WCP coordinates many coding agents on one shared local `dev` checkout. It is a seating chart for who may write which file right now, plus rules so agents treat drift as other workers rather than corruption.

Home: [watercoolerprotocol.com](https://watercoolerprotocol.com)

`.WCP/` holds two layers. The floor (`.WCP/RUN.md`, `.WCP/run.sqlite`, and its wal/shm) is gitignored and never committed. The queue (`.WCP/issues/`) is tracked and committed with the branch. Other local runtime under `.WCP/` (socket, lock, pid, log, mode, barrels) is not the queue; hooks reject every `.WCP/` path that is not under `.WCP/issues/`.

## Place in the Git loop

```
local dev          agents + you build here; the board stays on this machine
    ↓ you check     issues in .WCP/issues/ ride with the commit
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

## Floor and queue

The floor is who is mid-write on which source file. `.WCP/RUN.md` is a rendered view of that occupancy plus `arch`. It is not a backlog. Do not put specs, ticket status, or diffs on it.

The queue is what work exists, who holds the ticket, and what done means. It lives in git under `.WCP/issues/`. A ticket lease is not a source-file lease. Do not `acquire` an issue file. One live source file per agent still holds.

This queue is for one builder running many agents on one checkout. It does not call Linear, Jira, GitHub Issues, or Notion.

V1 implements L1 fully. L2 is `write_ok` plus git hooks. Harness-level wrapping of editor write tools is later.

## Actors

A human starts a run and sets `arch` (the session’s architectural aim). Each developer agent names itself. The id is short and lowercase (`session-refresh`, `tw-331`). The agent calls `name`, then exports `WCP_AGENT` and `WCP_NAME_TOKEN`. A second agent who asks for a taken name gets `name_taken` and picks another. The same token may confirm the same name. A token presented for a different id gets `already_named`. The board holds occupancy and those names. It does not assign them.

## Lease

A lease is an edit burst on a file that was already in the worktree, not a task and not a new file.

`wcp start` snapshots the worktree into `existed` (tracked files plus untracked files git does not ignore). That snapshot is the set of files that existed when work began. `wcp start` again does not refresh it. `wcp start --force` does.

- **Test file:** write it. No acquire, no release. A test path is never a claim.
- **Any other path not in `existed`:** write it. No acquire, no release. It did not exist when the run started, so one worker owns it. Do not start a second writer on a new path. Later edits to that new file stay unclaimed for the rest of the run.
- **A path in `existed`:** acquire it before writing, including when the file has since been deleted. `acquire` is refused until a test on disk names that path.
- Acquire immediately before the write.
- Release the instant the write is on disk — before tests, thinking, or waiting.
- Failed tests → `look` → acquire again (a new acquire, not a held lease).
- `reup` extends `expires_at` only while still flushing that burst.
- Idle leases are a violation. One live path per agent. One agent per path.
- Default TTL: 60 seconds.

Test paths: `*.test.ts` / `*.test.tsx` / `*.test.js` / `*.test.jsx` / `*.test.mjs` / `*.test.cjs` / `*.test.mts` / `*.test.cts`, the same with `.spec.`, any file under `__tests__/`, `*_test.go`, `*_test.py`, `test_*.py`, `*_test.rs`, `*_test.rb`, `*_spec.rb`, `*Test.java`, `*Tests.java`, `*.test.cs`, `*_test.exs`.

## Tests first, not on the board

Each agent writes or appends their test before acquiring an existing file. The test file is not claimed. A one-line comment names the path they are about to claim, states what the test proves, and points at `arch`:

```
// WCP auth-1: src/auth/session.ts refresh cookie rotates on session mint (arch)
```

(`# WCP` / `-- WCP` in other languages.) The line must contain `WCP <id>:` and the claimed path. The referee accepts the claim only when that test file exists, is a test path, was modified during this run, and a line names both the agent and the path. It does not run the test.

Never delete someone else’s tests. Never hollow a test to make your slice green. During a run, execute **your** tests. Mid-run red often means another agent is mid-edit; do not “fix” their source to pass yours. Full green is the human’s gate before `origin/dev`.

Prefer a per-slice test file so two agents are not appending to the same test.

## Overtake

If you need a leased path and the lease is **expired or the recorded pid is dead**, you may take it — only to finish the work already in motion. Inherit `doing` and `scope`. Set `from_agent`. Do not revert their hunks. Do not swap designs.

If the work is wrong, do not overtake. Start a new lease after `arch` or the human says so.

## Barrels

Lockfiles, generated clients, root schema: still exclusive (every path is). Short leases still serialize them. `.WCP/barrels` is a glob list the skill treats as extra-hot. It is not a second lock type.

## Drift

Re-read the board and the real file before every write. On acquire, store `sha256` of the path (`MISSING` if the file does not exist). If disk ≠ snapshot: `drift`. Change outside your scope: leave it. Change inside your scope: stop, look, wait or retarget. Never rewind the repo.

## Store

`.WCP/run.sqlite` — local file, WAL, `busy_timeout=5000`. Not Prisma, not Turso, not Postgres. Four tables. Raw SQL. The daemon is the only client.

```sql
CREATE TABLE run (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  branch TEXT NOT NULL DEFAULT 'dev',
  arch TEXT NOT NULL DEFAULT '',
  ttl_sec INTEGER NOT NULL DEFAULT 60,
  created_at TEXT NOT NULL,
  snap_at TEXT
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
  pid INTEGER,
  test_path TEXT NOT NULL DEFAULT ''
);

CREATE TABLE existed (
  path TEXT PRIMARY KEY
);

CREATE TABLE actor (
  agent_id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  named_at TEXT NOT NULL,
  pid INTEGER
);
```

One run row. `arch` is the aim of the session. `snap_at` is when `existed` was captured. One live row per agent, one per path. `UNIQUE(path)` is the exclusive lease. `test_path` is the test file that justified the claim. `existed` is the worktree at `snap_at`. One `actor` row per name reserved for the run. `token` is the proof that this session owns the name. `pid` is set for a long-lived MCP client and left null for the one-shot CLI. Timestamps are ISO-8601 UTC. No test text, no source, no chat. `look` returns names without tokens.

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
| `look` | `{ arch, branch, ttl_sec, now, names[], live[] }` (`drift` on each live row; names omit tokens) |
| `start` | session row; does not wipe live or names unless `force` |
| `stop` | all live rows and names gone, daemon exits |
| `name { agent, token?, pid? }` | `{ agent, token }`, or `name_taken` / `already_named` / `no_run` |
| `set_arch` | session aim; `{ human: true }` required |
| `acquire { agent, path, doing, test, scope?, pid? }` | row inserted, or `no_test` / `test_file` / `new_file` / `conflict` / `agent_busy` |
| `release { agent }` | row gone |
| `reup { agent }` | `expires_at` += ttl if this agent holds an unexpired row |
| `overtake { agent, path, test }` | `not_idle` if live; else inherit intent, set `from_agent`, require `test` |
| `write_ok { agent, path }` | ok (`claim: test` or `claim: new_file` with no lease), or `no_lease` / `wrong_path` / `expired` / `drift` / `wrong_branch` / `no_run` |
| `reap` | `{ released }` plus dead-pid names dropped |

`acquire` on a test path is `test_file`. `acquire` on a path absent from `existed` is `new_file`. Otherwise the test file must already be on disk.

`write_ok` order: run exists; `HEAD` == `run.branch`; if the path is a test file, ok with `claim: test`; if the path is not in `existed`, ok with `claim: new_file`; else agent holds `path`, lease not expired, disk sha == snapshot (or both `MISSING`).

No `wait` RPC. On conflict: retarget, overtake if idle, or pick another path from `arch`.

`set_arch` is human-only. MCP does not expose it.

## A single agent turn

```
name <id>          export WCP_AGENT and WCP_NAME_TOKEN
look
write/append the test that names the existing path    (no acquire)
# new file: write it and stop. no acquire, no write-ok
look
acquire existing path --test <test-file>
write-ok
re-read source from disk
edit, flush to disk
release
run your tests
if red → look → acquire → write-ok → edit → release → run again
```

At a healthy N, `live` should be almost empty most of the time. A long live list means people are camping through tests.

## Issues

```
.WCP/issues/
  open/
  in-progress/
  done/
  canceled/
  blocked/
```

Each issue is one markdown file. The filename keeps a stable id so a status move does not depend on the title (`0123-rotate-refresh-token.md`). `status` inside the file is the source of truth. The folder is a projection: update `status`, then move the file (`git mv` once it is tracked).

```yaml
---
id: 0123
title: Rotate refresh token on session mint
status: open | in-progress | done | canceled | blocked
priority: low | normal | high | critical
assignee:          # agent id, empty if unclaimed
lease_expires:     # ISO-8601 UTC, empty if unclaimed
scope:             # what this ticket is allowed to change
acceptance:        # short done definition
files: []          # paths touched while solving
commit:            # hash that closed it, empty until done
reason:            # why it was canceled or blocked; empty unless status is canceled or blocked
---
```

The body is the spec, short enough to work from.

Gitignore, and what `wcp init` writes:

```
.WCP/RUN.md
.WCP/run.sqlite
.WCP/*.sqlite-wal
.WCP/*.sqlite-shm
```

A blanket `.WCP/` ignore is removed when init runs, because it would hide the queue. Always commit `.WCP/issues/`. Never commit the board or sqlite.

### Ticket lease

Claim: set `assignee` to the agent id, `status: in-progress`, `lease_expires` to now + 10 minutes (UTC), write the file, move it to `in-progress/`. Re-read. If `assignee` is not you, you do not hold it.

The holder renews inside that window by setting `lease_expires` to now + 10 minutes again. Editing the issue file does not take a source-file lease.

Reclaim when `lease_expires` is past and the holder is not renewing. Clear `assignee` and `lease_expires`, set `status: open`, move the file to `open/`. Reclaim is idempotent. Only one agent may be `assignee`. If two writes race, the last writer re-reads and leaves a single assignee. A reclaim that finds a future `lease_expires` and an assignee leaves that claim in place.

Close when the work matches `acceptance`. The worker records touched paths in `files` as they land, releases every source-file lease, and leaves the tree dirty. A worker does not run `git commit` and does not run `git stash`. On a shared checkout, a stash hides another writer's uncommitted files.

The orchestrator is the only one who commits. A commit happens only when `wcp look` shows no live source-file lease. A live lease means a writer is mid-edit. Wait. Do not commit that burst and do not stash it. An in-progress ticket is not a source-file lease.

1. Commit the work. `files` already lists the paths. `commit` cannot name a hash that does not exist yet.
2. Write that hash into `commit`, set `status: done`, clear `assignee` and `lease_expires`, and move the file to `done/`.
3. Commit that issue-file update. `wcp look` is still empty.

If the orchestrator has not committed, leave `commit` empty and do not set `done`. The issue file is the completion record.

Cancel when the work will not be done. The holder may cancel a ticket they hold. The orchestrator may cancel an open ticket, or an expired `in-progress` ticket. Do not cancel a ticket another agent holds under a live lease. Write `reason` (required), set `status: canceled`, clear `assignee` and `lease_expires`, and move the file to `canceled/`. Leave `commit` empty unless a work hash already exists. Do not delete the file and do not set `done`. Re-read and leave a single `reason`. The orchestrator commits the issue file, and only when `wcp look` shows no live source-file lease. Do not stash to make that commit. Search `canceled/` and `status: canceled` before filing the same work again. Revive only when the user says so: set `status: open`, clear the lease, move to `open/`, and leave `reason` in place.

Block when the work is still wanted and must not be claimed yet. The holder may block a ticket they hold. The orchestrator may block an open ticket, or an expired `in-progress` ticket. Do not block a ticket another agent holds under a live lease. Write `reason` (required), set `status: blocked`, clear `assignee` and `lease_expires`, and move the file to `blocked/`. Leave `commit` empty unless a work hash already exists. Do not delete the file, do not set `done`, and do not set `canceled`. Re-read and leave a single `reason`. The orchestrator commits the issue file, and only when `wcp look` shows no live source-file lease. Do not stash to make that commit. Do not claim a file in `blocked/`. Search `blocked/` and `status: blocked` before filing the same work again. Unblocking sets `status: open`, clears the lease, moves the file to `open/`, and leaves `reason` in place.

### How a ticket is worked

On start, read `open/` and `in-progress/`. Reclaim expired tickets. Do not rebuild that list on `RUN.md`. `arch` stays the session aim, not a copy of every ticket. If the queue directories do not exist and this run needs a queue, create `open/`, `in-progress/`, `done/`, `canceled/`, and `blocked/`, and one issue taken from the current `arch` only.

The orchestrator, or the agent if none is assigned, picks one file in `open/` and claims it. Skip `blocked/` and `canceled/`. One ticket per agent unless the user says otherwise. Do not claim a directory. The body is the spec. Implementation uses the file leases above: test first, short source lease, release before tests, thinking, waiting, or the orchestrator's commit. Workers do not commit and do not stash. Append paths to `files`. Do not put the diff on `RUN.md`.

Two agents do not hold the same ticket. They do not hold the same source file. Different files on one ticket only when `scope` allows it, and each agent still holds one live source file. An idle ticket lease is a protocol violation, the same as an idle file line.

### Two clocks

Do not collapse them.

- File overtake stays the floor rule. A source-file lease is idle when `expires_at` has passed (default TTL 60 seconds) or the recorded pid is dead. `overtake` inherits `doing` and `scope`. That clock is not `lease_expires`.
- Ticket reclaim is 10 minutes on the issue's `lease_expires`.

## What this system is not

- **Not a substitute for Git.** The orchestrator makes the local commit, and only when no source-file lease is live. Push and the PR to main stay the human export, which also waits until `wcp look` is empty.
- **Not Watercooler** (threads + ball-passing). Occupancy ≠ conversation.
- **Not worktrees.** Those isolate checkouts. WCP keeps everyone on one live `dev`.
- **Not a backlog on `RUN.md`.** Specs, status, and the closing hash live on the issue file. The board is occupancy and `arch`.
- **Not Linear, Jira, GitHub Issues, or Notion.** Those stay with scaled teams. WCP work is assigned from `.WCP/issues/` only.
- **Not Turso/Prisma/Neon.** The board is a mutex with a few strings.

## Failure modes the system accepts

- Barrel files that already exist still serialize.
- New paths are unleased. Two workers can write the same new file; the run assumes one owner.
- Test files are unleased. Two workers can append to the same test file. Prefer a per-slice test file.
- Honor system will be ignored by some models; L1/L2 exist for that.
- You remain the gate before `origin/dev`. WCP keeps agents from eating each other. It does not review the pile.
- Shell bypass of editor tools can still write without `write_ok`. V1 does not revert those writes (revert is rewind).
- Operating point is 8–20 writers on disjoint files, not 100.

## Paths

Repo root is `git rev-parse --show-toplevel`. WCP refuses to run outside a git checkout. Board paths are relative to that root, POSIX, no `..`, no leading `./`, no absolutes.

Agent ids match `^[a-z0-9][a-z0-9._:-]{0,63}$`. The agent chooses the id. `name` reserves it for the run. A null `pid` (CLI) stays until `stop` or `start --force`. A recorded `pid` that is dead can be reclaimed by a new `name`, and `reap` drops it.
