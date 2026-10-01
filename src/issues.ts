export const ISSUE_STATUSES = [
  "open",
  "in-progress",
  "in-review",
  "done",
  "canceled",
  "blocked",
] as const;

export type IssueStatus = (typeof ISSUE_STATUSES)[number];

const ARCHIVE_STATUSES = new Set<IssueStatus>(["done", "canceled"]);
const CREATED_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?Z$/;
const ID_RE = /^\d{4,}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isIssueStatus(value: string): value is IssueStatus {
  return (ISSUE_STATUSES as readonly string[]).includes(value);
}

function createdParts(created: string): RegExpMatchArray {
  const match = CREATED_RE.exec(created);
  if (!match) {
    throw new Error(`created must be ISO-8601 UTC with minutes: ${created}`);
  }
  return match;
}

/** `2026-10-01T12:02:00Z` → `20261001T1202Z`. The minute is the precision of the filename. */
export function issueStamp(created: string): string {
  const match = createdParts(created);
  return `${match[1]}${match[2]}${match[3]}T${match[4]}${match[5]}Z`;
}

export function issueSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "issue";
}

export function issueFilename(created: string, id: string, slug: string): string {
  const padded = id.padStart(4, "0");
  if (!ID_RE.test(padded)) {
    throw new Error(`issue id must be digits: ${id}`);
  }
  if (!SLUG_RE.test(slug)) {
    throw new Error(`issue slug must be lowercase words: ${slug}`);
  }
  return `${issueStamp(created)}-${padded}-${slug}.md`;
}

/**
 * Path under `.wcp/issues/`. Hot statuses stay flat. `done` and `canceled`
 * use the UTC day from `created`, and the filename does not change on a move.
 */
export function issueRelPath(status: string, created: string, filename: string): string {
  if (!isIssueStatus(status)) {
    throw new Error(`unknown issue status: ${status}`);
  }
  if (filename.includes("/") || filename.includes("\\")) {
    throw new Error(`issue filename must be a single path segment: ${filename}`);
  }
  if (!ARCHIVE_STATUSES.has(status)) {
    return `${status}/${filename}`;
  }
  const match = createdParts(created);
  return `${status}/${match[1]}/${match[2]}/${match[3]}/${filename}`;
}
