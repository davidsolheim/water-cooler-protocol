## Water Cooler Protocol

This checkout may have many coding agents on one local `dev` working tree.

- Skill: `water-cooler-protocol` (load it for every session in this repo)
- Start a run: `wcp init --arch "<aim of this session>" --branch dev`
- Give each agent an id in the first prompt (`you are auth-1`) and `export WCP_AGENT=<id>`
- Agents call `wcp look` / `acquire` / `write-ok` / `release`. They do not push, reset HEAD, or rewind sibling edits
- `.WCP/` is gitignored occupancy state. Do not commit it
