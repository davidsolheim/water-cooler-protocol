# AGENTS.md

This repo is the Water Cooler Protocol tool (`wcp` / `wcpd`), not a Next app.

## Product

- Spec: `PROTOCOL.md`
- Vision: `VISION.md`
- Player instructions: `skill/water-cooler-protocol/SKILL.md`
- Facts live in `PROTOCOL.md`. Do not fork them into the skill.

## Stack

- TypeScript on Bun
- `bun:sqlite` (no Prisma)
- `bun test`
- Compile: `bun run build` → `dist/wcp`

## Git

- Integration branch: `dev`
- Do not commit `.WCP/` or `.watercool/`
- Do not push unless asked

## Tests

```bash
bun test
```

Protocol behavior (exclusive lease, TTL, overtake, drift, write_ok) must stay covered. Do not reintroduce `wait` from `legacy/wcooler.sh`.
