# AGENTS.md

This repo is wcp. It is a spec and a skill. It is not a daemon.

## Product

- Spec: `PROTOCOL.md`
- Player instructions: `skill/water-cooler-protocol/SKILL.md`
- Keep those two in agreement.

## Git

- Integration branch: `dev`
- Commit `.wcp/issues/`
- Do not commit any other path under `.wcp/` or `.watercool/`
- Do not commit while an issue is in `.wcp/issues/in-progress/`
- Do not push unless the run is quiet: `in-progress/` is empty and this agent has no further task
- Do not reset, checkout, or stash another agent's work

## Tests

```bash
python3 -m unittest discover -s scripts/linear-import -p 'test_*.py'
```

The Python suite checks the Linear importer's issue paths.
