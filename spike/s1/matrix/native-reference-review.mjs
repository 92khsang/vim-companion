import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { engineState } from "../bounded-gates.mjs";

const [file, originalReference, newReference, output] = process.argv.slice(2);
const read = (path) => {
  const bytes = readFileSync(path);
  return {
    raw: JSON.parse(bytes),
    file: basename(path),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
};
const measured = read(file),
  original = read(originalReference),
  clean = read(newReference);
assert.equal(measured.raw.gate, "native");
assert.equal(measured.raw.status, "native-gate-passed");
assert.equal(measured.raw.reference.sha256, original.sha256);
assert.equal(clean.raw.status, "native-baseline-recorded");
assert.deepEqual(clean.raw.resourcePreflight.errors, []);
assert.deepEqual(clean.raw.resourceFinal.errors, []);
assert.deepEqual(clean.raw.cleanup.remaining, []);
assert.deepEqual(clean.raw.cleanup.errors, []);
assert.deepEqual(original.raw.cases, clean.raw.cases);
assert.equal(original.raw.trials.length, clean.raw.trials.length);
for (const key of ["product", "node", "vimBundleSha256"]) {
  assert.deepEqual(measured.raw[key], clean.raw[key]);
  assert.deepEqual(original.raw[key], clean.raw[key]);
}
const settings = { ...measured.raw.settings };
delete settings["vim.normalModeKeyBindingsNonRecursive"];
delete settings["vim.visualModeKeyBindingsNonRecursive"];
assert.deepEqual(settings, clean.raw.settings);
assert.deepEqual(original.raw.settings, clean.raw.settings);
for (const source of [measured, original, clean]) {
  assert.equal(source.raw.delivery.expected.length, 1000);
  assert.deepEqual(
    source.raw.delivery.observed.map((item) => item.key),
    source.raw.delivery.expected,
  );
  assert.equal(
    source.raw.vimScript.observed.text,
    source.raw.vimScript.expected,
  );
}
for (const source of [measured, original])
  for (const trial of source.raw.trials) {
    const reference = clean.raw.trials.find(
      (item) =>
        item.case === trial.case && item.round === Math.min(trial.round, 1),
    );
    assert.ok(reference);
    for (const point of ["before", "after"])
      assert.deepEqual(
        engineState(trial[point]),
        engineState(reference[point]),
      );
    if (trial.finalSnapshot)
      assert.deepEqual(
        engineState(trial.finalSnapshot),
        engineState(trial.after),
      );
  }
const review = {
  method:
    "Independent state corroboration against a resource-clean reference; original reference linkage and raw data are unchanged.",
  inputs: [measured, original, clean].map(({ file, sha256 }) => ({
    file,
    sha256,
  })),
  measuredTrials: measured.raw.trials.length,
  verifiedEngineStates: measured.raw.trials.length * 2,
  originalCondition: measured.raw.condition,
  supplementalCondition: clean.raw.condition,
  limitation:
    "Separate CPU/concurrency conditions and newer harness instrumentation; this is not a new reliability run. The reference reproduces interleaved native cases only, not individually repeated cases.",
};
writeFileSync(output, JSON.stringify(review, null, 2) + "\n", { flag: "wx" });
console.log(
  JSON.stringify({
    trials: review.measuredTrials,
    verifiedEngineStates: review.verifiedEngineStates,
  }),
);
