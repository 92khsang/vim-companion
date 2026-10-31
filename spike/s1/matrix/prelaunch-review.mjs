import assert from "node:assert/strict";
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function sourceInventory(root) {
  const files = {};
  function visit(directory) {
    for (const name of readdirSync(join(root, directory)).sort()) {
      const relative = join(directory, name),
        path = join(root, relative);
      const stat = lstatSync(path);
      assert.ok(
        !stat.isSymbolicLink(),
        "reviewed sources must not contain symlinks",
      );
      if (stat.isDirectory()) visit(relative);
      else {
        assert.ok(stat.isFile());
        const bytes = readFileSync(path);
        files[relative] = { bytes: bytes.length, sha256: hash(bytes) };
      }
    }
  }
  visit("");
  return files;
}

// This verifies a retained review of one interrupted invocation, not an automatic
// exemption for every run that happens to lack an options file.
export function verifyPrelaunchReview(file, directory, batchBytes, run) {
  const bytes = readFileSync(file),
    review = JSON.parse(bytes);
  assert.equal(review.format, "s1-reviewed-prelaunch-interruption-v1");
  assert.equal(resolve(review.batchDirectory), resolve(directory));
  assert.equal(review.batchSha256, hash(batchBytes));
  assert.deepEqual(review.run, run);
  assert.equal(run.signal, "SIGTERM");
  assert.ok(
    Number.isInteger(run.exitCode) && run.exitCode !== 0 && run.finished,
  );
  assert.ok(Date.parse(review.reviewedAt) >= Date.parse(run.finished));
  for (const key of [
    "ideLauncher",
    "measuredStarted",
    "measuredFinished",
    "trials",
  ])
    assert.equal(
      run[key],
      undefined,
      "measurement evidence contradicts prelaunch review",
    );
  assert.equal(review.originalsPreservedAfterInterruption, true);
  assert.equal(
    review.controlFlowReviewed.markerWritePrecedesOnlyExecutionChild,
    true,
  );
  assert.equal(review.controlFlowReviewed.markerHasNoDeletionPath, true);
  assert.equal(
    review.controlFlowReviewed.preMarkerNodeChildIsSyntaxCheckOnly,
    true,
  );
  assert.equal(review.matrixCellMeasured, false);
  for (const path of [
    run.id + ".json",
    run.id + "-termination.json",
    run.id + "-sources/matrix-options.json",
  ])
    assert.ok(
      lstatSync(join(directory, path), { throwIfNoEntry: false }) === undefined,
      "prelaunch prerequisite no longer absent: " + path,
    );
  assert.deepEqual(
    sourceInventory(join(directory, "sources")),
    review.frozenSources,
  );
  assert.deepEqual(
    sourceInventory(join(directory, run.id + "-sources")),
    review.partialSources,
  );
  const wrapper = readFileSync(
    join(directory, "sources/matrix/run.mjs"),
    "utf8",
  );
  const marker = wrapper.indexOf('join(sources, "matrix-options.json")');
  const spawn = wrapper.indexOf("const child = spawn(");
  assert.ok(marker > 0 && spawn > marker);
  assert.equal((wrapper.match(/\bspawn\(/g) ?? []).length, 1);
  assert.equal((wrapper.match(/\bexecFileSync\(/g) ?? []).length, 1);
  const syntaxCheck = wrapper.indexOf(
    'execFileSync(process.execPath, ["--check", script])',
  );
  assert.ok(syntaxCheck >= 0 && syntaxCheck < marker);
  const batchSource = readFileSync(
    join(directory, "sources/matrix/batch.mjs"),
    "utf8",
  );
  assert.ok(batchSource.includes('[join(frozen, "matrix/run.mjs"), file]'));
  return {
    file,
    sha256: hash(bytes),
    run: run.id,
    reviewedAt: review.reviewedAt,
    conclusion:
      "No IDE launch: the preserved source marker required before execution-child spawn is absent in this reviewed invocation.",
    limitation:
      "The source-control-flow review and preservation of originals are explicit premises. This is not a measured matrix result or a generic missing-file exemption.",
  };
}
