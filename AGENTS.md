# AGENTS.md

This repo is the Water Cooler Protocol tool (`wcp` / `wcpd`), not a Next app.

## Product

- Spec: `PROTOCOL.md`
- Vision: `VISION.md`
- Player instructions: `skill/water-cooler-protocol/SKILL.md`
- Facts live in `PROTOCOL.md`. The skill repeats the issue-queue rules so an agent can claim, renew, reclaim, and close from the skill alone. Keep the two in agreement.

## Stack

- TypeScript on Bun
- `bun:sqlite` (no Prisma)
- `bun test`
- Compile: `bun run build` → `dist/wcp`

## Git

- Integration branch: `dev`
- Do not commit the board or sqlite (`.WCP/RUN.md`, `.WCP/run.sqlite`, wal, shm) or `.watercool/`
- Do commit `.WCP/issues/`
- Only the orchestrator runs `git commit`, and only when `wcp look` shows no live source-file lease. Workers do not commit or stash.
- Do not push unless asked

## Tests

```bash
bun test
```

Protocol behavior (exclusive lease, TTL, overtake, drift, write_ok, test-before-claim, unclaimed test files and new files, self-named agents) must stay covered. Do not reintroduce `wait` from `legacy/wcooler.sh`.
