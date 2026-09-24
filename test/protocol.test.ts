import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MISSING_SHA,
  addSecondsIso,
  isExpired,
  isTestPath,
  isoNow,
  normalizeBoardPath,
  pidAlive,
  sha256File,
  testMarksPath,
  validateAgentId,
} from "../src/protocol.ts";

const temps: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "wcp-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("validateAgentId", () => {
  test("accepts auth-1 and ui-2", () => {
    expect(validateAgentId("auth-1")).toBe("auth-1");
    expect(validateAgentId("ui-2")).toBe("ui-2");
  });

  test("rejects empty, uppercase, and space", () => {
    expect(() => validateAgentId("")).toThrow();
    expect(() => validateAgentId("Auth-1")).toThrow();
    expect(() => validateAgentId("auth 1")).toThrow();
  });
});

describe("normalizeBoardPath", () => {
  test("returns posix path relative to repo root", () => {
    const root = tempDir();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), "x");
    expect(normalizeBoardPath(root, join(root, "src", "a.ts"))).toBe("src/a.ts");
    expect(normalizeBoardPath(root, "src/a.ts")).toBe("src/a.ts");
  });

  test("rejects escape via .. and absolute paths outside the repo", () => {
    const root = tempDir();
    mkdirSync(join(root, "src"), { recursive: true });
    expect(() => normalizeBoardPath(root, "../secret")).toThrow();
    expect(() => normalizeBoardPath(root, "/etc/passwd")).toThrow();
  });

  test("strips leading ./", () => {
    const root = tempDir();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), "x");
    expect(normalizeBoardPath(root, "./src/a.ts")).toBe("src/a.ts");
  });
});

describe("sha256File", () => {
  test("returns MISSING when the file does not exist", () => {
    const root = tempDir();
    expect(sha256File(join(root, "nope.ts"))).toBe(MISSING_SHA);
  });

  test("hashes file contents", () => {
    const root = tempDir();
    const path = join(root, "a.ts");
    writeFileSync(path, "hello");
    const a = sha256File(path);
    expect(a).toHaveLength(64);
    expect(a).not.toBe(MISSING_SHA);
    writeFileSync(path, "hello!");
    expect(sha256File(path)).not.toBe(a);
  });
});

describe("ttl", () => {
  test("isExpired is true after ttl elapses", () => {
    const start = isoNow(new Date("2026-09-18T19:51:00Z"));
    const expires = addSecondsIso(start, 60);
    expect(isExpired(expires, "2026-09-18T19:51:59Z")).toBe(false);
    expect(isExpired(expires, "2026-09-18T19:52:00Z")).toBe(true);
    expect(isExpired(expires, "2026-09-18T19:52:01Z")).toBe(true);
  });
});

describe("test paths", () => {
  test("recognizes test files and leaves source files alone", () => {
    expect(isTestPath("src/auth/session.test.ts")).toBe(true);
    expect(isTestPath("src/auth/session.test.tsx")).toBe(true);
    expect(isTestPath("src/__tests__/session.ts")).toBe(true);
    expect(isTestPath("src/auth/session.ts")).toBe(false);
    expect(isTestPath("src/auth/session.tsx")).toBe(false);
  });

  test("a marker names the claimed path and not a longer sibling", () => {
    const text = "// WCP auth-1: src/a.ts refresh rotates (arch)\n";
    expect(testMarksPath(text, "auth-1", "src/a.ts")).toBe(true);
    expect(testMarksPath(text, "ui-2", "src/a.ts")).toBe(false);
    expect(testMarksPath(text, "auth-1", "src/a.tsx")).toBe(false);
    expect(testMarksPath(text, "auth-1", "src/b.ts")).toBe(false);
  });
});

describe("pidAlive", () => {
  test("this process is alive; a huge pid is not", () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(999_999_999)).toBe(false);
  });
});
