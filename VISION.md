# wcp

A shared checkout needs one visible record of who is editing what. That record is the issue file's folder.

`in-progress/` means an agent is in that work on this machine. `done/` means the writing is finished. `deployed-dev/` and `deployed-main/` are the history after the commit reaches those branches.

Agents read each other's issue files and adapt. They do not commit while someone is still in `in-progress/`.
