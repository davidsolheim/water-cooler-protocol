import { describe, expect, test } from "bun:test";
import { renderRunMd } from "../src/render.ts";
import type { LiveRow } from "../src/rpc.ts";

function row(over: Partial<LiveRow>): LiveRow {
  return {
    agent_id: "auth-1",
    path: "src/a.ts",
    doing: "research the parser",
    scope: "parse",
    from_agent: null,
    leased_at: "2026-09-18T19:51:00Z",
    expires_at: "2026-09-18T19:56:00Z",
    sha256: "abc",
    pid: 1001,
    test_path: "src/a.test.ts",
    drift: false,
    expired: false,
    last_write_at: "2026-09-18T19:51:00Z",
    ...over,
  };
}

describe("RUN.md write age", () => {
  test("a 4-minute seat looks stale and a 5-minute seat looks takeable", () => {
    const stale = renderRunMd({
      ttl_sec: 300,
      now: "2026-09-18T19:55:00Z",
      live: [row({ expired: false })],
    });
    expect(stale).toContain("wrote 4m ago | stale");
    expect(stale).not.toContain("takeable");

    const takeable = renderRunMd({
      ttl_sec: 300,
      now: "2026-09-18T19:56:00Z",
      live: [row({ expired: true, expires_at: "2026-09-18T19:56:00Z" })],
    });
    expect(takeable).toContain("wrote 5m ago | takeable");
    expect(takeable).not.toContain("| stale");
  });

  test("a fresh write does not look stale", () => {
    const text = renderRunMd({
      ttl_sec: 300,
      now: "2026-09-18T19:51:30Z",
      live: [row({ last_write_at: "2026-09-18T19:51:00Z" })],
    });
    expect(text).toContain("wrote 30s ago");
    expect(text).not.toContain("stale");
    expect(text).not.toContain("takeable");
  });
});
