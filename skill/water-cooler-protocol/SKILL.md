---
name: water-cooler-protocol
description: >
  Occupancy leases for many coding agents on one shared local checkout.
  Load when this repo's AGENTS.md mentions WCP, when WCP_AGENT is set, when
  coordinating parallel agents on local dev, or when the user runs /wcp.
  Use wcp look/acquire/write-ok/release before writing files. Never rewind
  sibling edits. Never push origin/dev as an agent.
---

# Water Cooler Protocol (player)

You are one writer among others on this checkout. Changed files are other workers, not corruption.

Spec: if this repo contains `PROTOCOL.md` for WCP, that file is the protocol. Commands below are the verbs.

## Identity

The first prompt assigns your id (`you are ui-2`). Export it:

```bash
export WCP_AGENT=<id>
```

Do not invent a second id. Do not call `wcp set-arch` or `wcp stop`.

## Turn

```
wcp look --json
# tests first: acquire test path, append tests with a WCP comment, release
wcp acquire --path <file> --doing "<burst>" --scope "<symbol>" --json
wcp write-ok --path <file> --json
# re-read the file from disk, edit, flush
wcp release --json
# run YOUR tests only
```

Lease is a burst. Release the instant bytes are on disk — before tests, thinking, or waiting. Holding a lease through the test runner is a protocol break. If you must write again, acquire again.

`wcp reup` only while still flushing this burst (TTL about to expire mid-write).

## Tests

Before implementation, write or append tests. First line of the new test:

```
// WCP <id>: <what it proves> (<arch>)
```

(`# WCP` / `-- WCP` in other languages.) Prefer a per-slice test file. Never delete someone else's tests. Never hollow a test to make your slice green. Foreign red is not your write. Full-suite green is the human's gate, not yours.

## Conflict (mandatory order)

On `conflict`, read `existing.doing` / `existing.scope`:

1. Same symbol or same intent → retarget or wait. Do not overtake a live burst.
2. `expired` or dead pid → `wcp overtake --path <file>` only to **finish** that work. Inherit intent. Do not revert hunks. Do not swap designs.
3. Else pick another path from `arch`. Do not busy-loop `look`.

If the work is wrong, do not overtake. Leave it.

## Drift

If `write-ok` returns `drift` on a path inside your scope: stop. `wcp look`. Wait or retarget. Never `git reset --hard`, `git checkout --`, or restore to "go first."

## Git

Do not commit `.WCP/`. Do not store source in `.WCP/`. Do not push. Do not rewind. `WCP_AGENT` is set: hooks will refuse push.

## Barrels

If the path matches `.WCP/barrels` (lockfiles, generated clients, root schema): extra-short burst. No thinking on the lease.

## Board

`wcp look` before every write. Edit occupancy only through `wcp`. Do not rewrite `.WCP/RUN.md` by hand (the daemon overwrites it).
