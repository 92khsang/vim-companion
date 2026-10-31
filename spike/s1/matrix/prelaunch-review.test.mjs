import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { sourceInventory, verifyPrelaunchReview } from "./prelaunch-review.mjs";
import { reviewOverlap } from "./overlap.mjs";

test("a case-bound prelaunch review resolves only the preserved unmeasured invocation", () => {
  const directory = mkdtempSync(join(tmpdir(), "s1-prelaunch-test-"));
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const run = {
    id: "stopped",
    cpuSet: "20-23",
    started: "2026-01-01T00:00:00.000Z",
    finished: "2026-01-01T00:00:00.050Z",
    signal: "SIGTERM",
    exitCode: 1,
  };
  mkdirSync(join(directory, "sources/matrix"), { recursive: true });
  mkdirSync(join(directory, "stopped-sources"));
  for (const name of ["run.mjs", "batch.mjs"])
    writeFileSync(
      join(directory, "sources/matrix", name),
      readFileSync(new URL(name, import.meta.url)),
    );
  writeFileSync(
    join(directory, "stopped-sources/partial.mjs"),
    "// Incomplete source copy.\n",
  );
  const batchBytes = Buffer.from(
    JSON.stringify({
      finished: run.finished,
      cpuTopology: "20,20,0\n",
      plan: {},
      runs: [run],
    }),
  );
  writeFileSync(join(directory, "batch.json"), batchBytes);
  const review = {
    format: "s1-reviewed-prelaunch-interruption-v1",
    batchDirectory: directory,
    batchSha256: hash(batchBytes),
    run,
    reviewedAt: "2026-01-01T00:00:01Z",
    originalsPreservedAfterInterruption: true,
    matrixCellMeasured: false,
    controlFlowReviewed: {
      markerWritePrecedesOnlyExecutionChild: true,
      markerHasNoDeletionPath: true,
      preMarkerNodeChildIsSyntaxCheckOnly: true,
    },
    frozenSources: sourceInventory(join(directory, "sources")),
    partialSources: sourceInventory(join(directory, "stopped-sources")),
  };
  const file = join(directory, "review.json");
  const save = () => writeFileSync(file, JSON.stringify(review));
  save();
  try {
    assert.equal(reviewOverlap([directory]).exclusions.length, 1);
    const overlap = reviewOverlap([directory], false, [file]);
    assert.equal(overlap.exclusions.length, 0);
    assert.equal(overlap.intervals.length, 0);
    assert.equal(overlap.resolvedPrelaunchInterruptions.length, 1);
    assert.throws(() =>
      verifyPrelaunchReview(file, directory, Buffer.from("different"), run),
    );
    assert.throws(() =>
      verifyPrelaunchReview(file, directory, batchBytes, { ...run, trials: 0 }),
    );
    writeFileSync(join(directory, "stopped-sources/matrix-options.json"), "{}");
    assert.throws(
      () => reviewOverlap([directory], false, [file]),
      /no longer absent/,
    );
    rmSync(join(directory, "stopped-sources/matrix-options.json"));
    symlinkSync("absent-target", join(directory, "stopped.json"));
    assert.throws(
      () => verifyPrelaunchReview(file, directory, batchBytes, run),
      /no longer absent/,
    );
    rmSync(join(directory, "stopped.json"));
    writeFileSync(
      join(directory, "stopped-sources/partial.mjs"),
      "// Changed.\n",
    );
    assert.throws(() => reviewOverlap([directory], false, [file]));
    review.originalsPreservedAfterInterruption = false;
    save();
    assert.throws(() =>
      verifyPrelaunchReview(file, directory, batchBytes, run),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
