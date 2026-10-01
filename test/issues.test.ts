import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  issueFilename,
  issueRelPath,
  issueSlug,
  issueStamp,
} from "../src/issues.ts";

const CREATED = "2026-10-01T12:02:00Z";
const NAME = "20261001T1202Z-0123-rotate-refresh-token.md";

describe("issue files", () => {
  test("stamps the filename from created and keeps the id", () => {
    expect(issueStamp(CREATED)).toBe("20261001T1202Z");
    expect(issueStamp("2026-10-01T12:02:59.125Z")).toBe("20261001T1202Z");
    expect(issueSlug("Rotate refresh token")).toBe("rotate-refresh-token");
    expect(issueFilename(CREATED, "123", "rotate-refresh-token")).toBe(NAME);
  });

  test("hot folders stay flat and archives use the filing day", () => {
    for (const status of ["open", "in-progress", "in-review", "blocked"]) {
      expect(issueRelPath(status, CREATED, NAME)).toBe(`${status}/${NAME}`);
    }
    expect(issueRelPath("done", CREATED, NAME)).toBe(`done/2026/10/01/${NAME}`);
    expect(issueRelPath("canceled", CREATED, NAME)).toBe(`canceled/2026/10/01/${NAME}`);
  });

  test("a status move keeps the filename and the filing day", () => {
    const filed = issueRelPath("open", CREATED, NAME);
    const reviewing = issueRelPath("in-review", CREATED, NAME);
    const done = issueRelPath("done", CREATED, NAME);
    expect(filed.endsWith(NAME)).toBe(true);
    expect(reviewing.endsWith(NAME)).toBe(true);
    expect(done.endsWith(NAME)).toBe(true);
    expect(done).toBe(`done/2026/10/01/${NAME}`);
    expect(done).not.toContain("2026/10/02");
  });

  test("the spec names the same stamp and archive day", () => {
    const protocol = readFileSync(new URL("../PROTOCOL.md", import.meta.url), "utf8");
    const skill = readFileSync(
      new URL("../skill/water-cooler-protocol/SKILL.md", import.meta.url),
      "utf8",
    );
    for (const text of [protocol, skill]) {
      expect(text).toContain(NAME);
      expect(text).toContain("done/2026/10/01/");
      expect(text).toContain("session:");
      expect(text).toContain("pr:");
    }
  });
});
