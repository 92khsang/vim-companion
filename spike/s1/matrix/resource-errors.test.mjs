import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resourceErrors } from "./resource-errors.mjs";

test("resource checks retain watcher failures from calibration and cold child logs", () => {
  const root = mkdtempSync(join(tmpdir(), "s1-resource-test-"));
  try {
    writeFileSync(
      join(root, "code.log"),
      "ordinary message\nEMFILE: too many open files, watch settings.json\n",
    );
    mkdirSync(join(root, "cold/trial-0000"), { recursive: true });
    writeFileSync(
      join(root, "cold/trial-0000/code.log"),
      "inotify_init() failed: Too many open files\n",
    );
    const result = resourceErrors(root);
    assert.equal(result.errors.length, 2);
    assert.equal(result.errors[0].line, 2);
    assert.ok(result.errors.some((error) => error.file.startsWith("cold/")));
  } finally {
    rmSync(root, { recursive: true });
  }
});
