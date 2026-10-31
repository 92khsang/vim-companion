import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import assert from "node:assert/strict";
import { resolve, basename } from "node:path";

export const startupEvidenceSha256 = createHash("sha256")
  .update(readFileSync(import.meta.filename))
  .digest("hex");

export function auditColdReadiness(raw) {
  const observations = [
    ...(raw.coldReferences ?? []).map((trial) => ({ reference: true, trial })),
    ...raw.trials.map((trial) => ({ reference: false, trial })),
  ].map(({ reference, trial }) => {
    const readiness = trial.readiness;
    const samples = (readiness?.attempts ?? []).flatMap((attempt) =>
      attempt.after ? [attempt.before, attempt.after] : [attempt.before],
    );
    const first = samples.findIndex(
      (sample) =>
        sample?.startupSequence > 0 && sample.startupSentinel?.ready === true,
    );
    const qualified =
      first >= 0 &&
      first === samples.length - 1 &&
      isDeepStrictEqual(readiness.ready, samples[first]) &&
      Number.isFinite(readiness.observedAt) &&
      Number.isFinite(trial.firstInputRequestedAt) &&
      trial.firstInputRequestedAt >= readiness.observedAt;
    return {
      reference,
      index: trial.index,
      qualified,
      firstContextReadySample: first,
      samples: samples.length,
      ...(!qualified
        ? {
            reason:
              "first context-ready observation was skipped or input ordering is unproven",
          }
        : {}),
    };
  });
  return {
    methodSha256: startupEvidenceSha256,
    definition:
      "Cold input follows the first observed editorTextFocus/vim.active sentinel; Extension.isActive is not an additional readiness condition. This proves ordering, not zero transport or scheduling delay.",
    observations,
    unqualified: observations.filter((observation) => !observation.qualified),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const [file, output] = process.argv.slice(2);
  assert.ok(file && output, "usage: startup-evidence.mjs RAW.json OUTPUT.json");
  const bytes = readFileSync(file),
    raw = JSON.parse(bytes);
  assert.equal(raw.gate, "cold");
  assert.ok(raw.finished, "startup review requires a finished raw run");
  const review = {
    rawFile: basename(file),
    rawSha256: createHash("sha256").update(bytes).digest("hex"),
    status: raw.status,
    ...auditColdReadiness(raw),
  };
  writeFileSync(output, JSON.stringify(review, null, 2) + "\n", { flag: "wx" });
  console.log(
    JSON.stringify({
      observations: review.observations.length,
      unqualified: review.unqualified.length,
    }),
  );
}
