import { expect, test } from "bun:test";
import { join } from "node:path";

test("linear import python suite passes under bun test", () => {
  const root = join(import.meta.dir, "..");
  const proc = Bun.spawnSync(
    ["python3", "-m", "unittest", "discover", "-s", "scripts/linear-import", "-p", "test_*.py"],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  const output = `${proc.stdout.toString()}\n${proc.stderr.toString()}`;
  if (proc.exitCode !== 0) {
    throw new Error(output);
  }
  expect(proc.exitCode).toBe(0);
  expect(output).toContain("OK");
});
