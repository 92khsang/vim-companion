import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Execute the shell helper itself: bash -n cannot detect paired apostrophes in a
// JavaScript comment that prematurely close and reopen its single-quoted argument.
const script = readFileSync(new URL("./cpu.sh", import.meta.url), "utf8");
const helper = script.match(/^windows\(\) \{[^]*?^\}/m)?.[0];
assert.ok(helper, "the CPU windows helper must exist");

test("CPU window counts execute the embedded Node argument intact", () => {
  const dir = mkdtempSync(join(tmpdir(), "s2-cpu-windows-"));
  try {
    const file = join(dir, "windows.jsonl");
    const count = (scenario, arm, kind) => {
      const result = spawnSync(
        "bash",
        [
          "-c",
          `${helper}\nwindows "$@"`,
          "cpu-windows",
          file,
          scenario,
          arm,
          kind,
        ],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /^\d+\n$/);
      return Number(result.stdout);
    };
    writeFileSync(file, "");
    for (const kind of ["all", "valid", "fatal"])
      assert.equal(count("any", "any", kind), 0);

    writeFileSync(
      file,
      JSON.stringify({ scenario: "idle", arm: "off", valid: true }) + "\n",
    );
    assert.equal(count("idle", "off", "all"), 1);
    assert.equal(count("idle", "off", "valid"), 1);
    assert.equal(count("any", "any", "fatal"), 0);
    assert.equal(count("typing", "off", "all"), 0);
    assert.equal(count("idle", "on", "all"), 0);

    const records = [
      { scenario: "idle", arm: "off", error: "boot", phase: "boot" },
      { scenario: "idle", arm: "on", error: "boot", phase: "boot" },
      { scenario: "idle", arm: "off", error: "start", phase: "start" },
      { scenario: "typing", arm: "off", valid: false, rerunnable: true },
      { scenario: "typing", arm: "on", valid: false, rerunnable: false },
    ];
    writeFileSync(
      file,
      records.map((r) => JSON.stringify(r)).join("\n") + "\n",
    );
    assert.equal(count("any", "any", "all"), 5);
    assert.equal(count("any", "any", "valid"), 0);
    assert.equal(count("any", "any", "fatal"), 3);
    assert.equal(count("idle", "off", "fatal"), 1);
    assert.equal(count("typing", "off", "fatal"), 0);
    assert.equal(count("typing", "on", "fatal"), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
