# Linear import

Copy a Linear team's issues into a repo's Water Cooler queue (`.WCP/issues/`) and build Notion page batches for the human board.

The Linear token is read from the named MCP server in `~/.grok/config.toml`. These scripts never print the token, the Authorization header, or the config file.

## Scripts

- `import-linear-to-wcp.py` fetches every issue on the given team keys, including archived issues, and writes one markdown file per issue.
- `fix-wcp-acceptance.py` replaces a heading-only acceptance line with a sentence from the body.
- `import-linear-comments.py` appends up to 50 Linear comments onto each imported file.
- `build-notion-batches.py` writes Notion `create-pages` payloads of at most 80 pages. It skips files that already have `notion_page_id`.
- `apply-notion-ids.py` writes `notion_page_id` and `notion_url` back into frontmatter and prints `filled` and `missing`.

## Usage

```bash
python3 scripts/linear-import/import-linear-to-wcp.py \
  --repo /path/to/repo \
  --server linear-teton \
  --teams SODA \
  --id-rule identity \
  --dry-run

python3 scripts/linear-import/import-linear-to-wcp.py \
  --repo /path/to/repo \
  --server linear-teton \
  --teams SODA \
  --id-rule identity

python3 scripts/linear-import/fix-wcp-acceptance.py --repo /path/to/repo

python3 scripts/linear-import/import-linear-comments.py \
  --repo /path/to/repo \
  --server linear-teton

python3 scripts/linear-import/build-notion-batches.py \
  --repo /path/to/repo \
  --data-source <notion-data-source-id> \
  --out /tmp/notion-batches \
  --tool-name notion__notion-create-pages

python3 scripts/linear-import/apply-notion-ids.py \
  --repo /path/to/repo \
  --results /tmp/notion-results
```

`--teams` accepts repeated keys or one comma-separated list. `--dry-run` prints counts and writes nothing.

When more than one team shares the workspace, pass every team key that should be imported. The fetch filter is `team.key in --teams`.

## Arguments

`import-linear-to-wcp.py`

| Argument | Meaning |
| --- | --- |
| `--repo` | Checkout that receives `.WCP/issues/` |
| `--server` | MCP server name in the grok config |
| `--teams` | Linear team key or keys |
| `--id-rule` | `identity` or `primary-then-rest` |
| `--dry-run` | Fetch and print counts. Write nothing |
| `--config` | Config path. Default `~/.grok/config.toml` |
| `--force` | Overwrite issue files that already exist |
| `--expect-total`, `--expect-open`, `--expect-done`, `--expect-canceled` | Exit 3 when a count differs |
| `--require-span MIN:MAX` | Require contiguous issue numbers with no gaps |

`identity` uses each Linear issue number as the WCP id, zero-padded to 4 digits (`SODA-7` is `0007`). It fails if two selected teams share a number.

`primary-then-rest` keeps the first `--teams` key's numbers and assigns every other selected team the next free ids, sorted by team key then number.

Filenames are `NNNN-<linear-id>-<slug>.md`, for example `0007-soda-7-short-title.md`.

`import-linear-comments.py` takes `--repo`, `--server`, `--config`, `--folders` (default: every queue folder), `--workers`, and `--dry-run`.

`build-notion-batches.py` takes `--repo`, `--data-source`, `--out`, `--tool-name` (default `notion__notion-create-pages`), `--batch` (1–80), `--title-property` (default `Issue name`), `--url-property` (default `Issue URL`), and `--dry-run`.

`apply-notion-ids.py` takes `--repo`, `--results` (a JSON file or a directory of create-pages results), and `--dry-run`.

## Status map

| Linear | WCP folder |
| --- | --- |
| Triage, Backlog, Todo, In Progress, In Review | `open` |
| Done, or status type completed | `done` |
| Canceled, Cancelled, Duplicate, or status type canceled | `canceled` |
| A status whose name contains "block" | `blocked` |

Open imports leave `assignee` and `lease_expires` empty. In Progress does not take a ticket lease. In Review does not start a review. `linear_status` keeps the Linear name. Canceled and blocked files get a `reason` that names the Linear status.

## Priority map

| Linear priority | WCP |
| --- | --- |
| 1 Urgent | `critical` |
| 2 High | `high` |
| 3 Medium, 4 Low, 0 None | `normal` |

## Notion

Create the database before the batches. Properties match the inventRight issues board:

Issue name (title), WCP (text), Issue URL (url), Status (Backlog, Todo, In Progress, In Review, Done, Canceled, Duplicate), Queue (open, in-progress, in-review, done, canceled, blocked), Priority (critical, high, normal, low), Assignee (text), Team (select), Project (select), Labels (multi-select), Due (date), Parent (text), Archived (checkbox).

Views: All (table grouped by Status), By status (board grouped by Status), Open queue (Queue is open), and one table per status.

Page body:

```
WCP `0007`. Linear [SODA-7](https://linear.app/example/issue/SODA-7/slug).

<acceptance>

Full spec: `.WCP/issues/done/0007-soda-7-slug.md`
```

Run each batch through the Notion MCP create-pages tool with `allow_async` false. Save the JSON results and pass that directory to `apply-notion-ids.py`. Confirm `filled` equals the issue count and `missing` is 0.
