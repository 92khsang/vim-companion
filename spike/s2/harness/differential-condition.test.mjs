import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const original = new URL(
  "../data/original-30ms-cbf136f/precheck/off-1.134.0.jsonl",
  import.meta.url,
);
const comparator = new URL("./differential-compare.mjs", import.meta.url);
const compare = (file, condition) =>
  execFileSync(process.execPath, [comparator.pathname, file], {
    encoding: "utf8",
    env: {
      ...process.env,
      S2_DIFF_PRECHECK: "100",
      S2_COUNT_LEADER_STABILIZE: String(condition),
    },
  });

test("the preserved original precheck still passes its original timing condition", () => {
  assert.match(compare(original.pathname, 0), /PRECHECK 1\.134\.0: .*: pass\n/);
});

test("the original precheck cannot qualify a 300 ms differential", () => {
  assert.match(
    compare(original.pathname, 300),
    /PRECHECK 1\.134\.0: .*: not pass\n/,
  );
});

test("mixed timing conditions and missing stabilization evidence cannot pass", () => {
  const dir = mkdtempSync(join(tmpdir(), "s2-condition-test-"));
  try {
    const records = readFileSync(original, "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    const file = join(dir, "runs.jsonl");
    const save = () =>
      writeFileSync(
        file,
        records.map((r) => JSON.stringify(r)).join("\n") + "\n",
      );
    records[0].countLeaderDelayMs = 300;
    save();
    assert.match(compare(file, 0), /PRECHECK 1\.134\.0: .*: not pass\n/);
    for (const record of records) record.countLeaderDelayMs = 300;
    save();
    assert.match(compare(file, 300), /invalid observations 100.*: not pass\n/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
