# Legacy v0.1 (`wcooler.sh`)

Retired. Do not extend.

v0.1 was a bash advisory script: line-scope claims, multiple writers per file, a WAITING queue, 15-minute leases, `.watercool/`, and `git apply` as the write path.

V1 is a different protocol: exclusive file leases, 60-second burst TTL, SQLite referee, no wait-loop. See `/PROTOCOL.md`.
