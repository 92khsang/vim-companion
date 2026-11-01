import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";

// The initial frozen V-b batch retained offsets before path redaction. Recover
// exact trial fragments from its retained logs without rewriting raw evidence.
const [file, sandbox, output] = process.argv.slice(2);
const bytes = readFileSync(file),
  raw = JSON.parse(bytes),
  root = resolve(sandbox);
assert.equal(raw.status, "remap-recorded");
const redact = (text) =>
  text.replaceAll(root, "$S1_SANDBOX").replaceAll(process.env.HOME, "$HOME");
const originals = new Map();
const retainedRotations = [];
for (const trace of raw.vimTrace) {
  const path = resolve(root, trace.file);
  assert.ok(path.startsWith(root + sep));
  const buffer = readFileSync(path).subarray(0, trace.bytes);
  assert.equal(buffer.length, trace.bytes);
  assert.equal(
    redact(buffer.toString("utf8")),
    trace.text,
    "retained log differs from the raw trace after identical redaction",
  );
  originals.set(trace.file, buffer);
}
// Frozen runners omitted Vim.1.log from their final glob. Reconstruct each
// active-log generation from retained before/after byte-count drops.
const generations = [];
let generation = 0,
  previousBytes;
for (const trial of raw.trials) {
  assert.equal(trial.traceOffsets.before.length, 1);
  assert.equal(trial.traceOffsets.after.length, 1);
  const before = trial.traceOffsets.before[0],
    after = trial.traceOffsets.after[0];
  assert.equal(before.file, after.file);
  if (previousBytes !== undefined && before.bytes < previousBytes) generation++;
  const beforeGeneration = generation;
  if (after.bytes < before.bytes) generation++;
  generations.push({ beforeGeneration, afterGeneration: generation });
  previousBytes = after.bytes;
}
const originalGeneration = (file, index) => {
  const age = generation - index;
  const name = age ? file.replace(/\.log$/, `.${age}.log`) : file;
  if (!originals.has(name)) {
    const bytes = readFileSync(resolve(root, name));
    originals.set(name, bytes);
    retainedRotations.push({
      file: name,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      text: redact(bytes.toString("utf8")),
    });
  }
  return { name, bytes: originals.get(name) };
};
const fragments = raw.trials.map((trial) => ({
  index: trial.index,
  fragments: trial.traceOffsets.after.map((after) => {
    const before = trial.traceOffsets.before.find(
      (item) => item.file === after.file,
    );
    const epoch = generations[trial.index];
    const first = originalGeneration(after.file, epoch.beforeGeneration);
    const last = originalGeneration(after.file, epoch.afterGeneration);
    const complete = Boolean(
      before &&
      first.bytes.length >= before.bytes &&
      last.bytes.length >= after.bytes &&
      (epoch.beforeGeneration !== epoch.afterGeneration ||
        before.bytes <= after.bytes),
    );
    return {
      file: after.file,
      retainedFiles: [...new Set([first.name, last.name])],
      complete,
      text: complete
        ? redact(
            (epoch.beforeGeneration === epoch.afterGeneration
              ? first.bytes.subarray(before.bytes, after.bytes)
              : Buffer.concat([
                  first.bytes.subarray(before.bytes),
                  last.bytes.subarray(0, after.bytes),
                ])
            ).toString("utf8"),
          )
        : null,
    };
  }),
}));
writeFileSync(
  output,
  JSON.stringify(
    {
      rawSha256: createHash("sha256").update(bytes).digest("hex"),
      verification:
        "Original active-log prefixes reproduce raw.vimTrace exactly after path redaction. Active-log generations follow retained byte-count drops; rotated files omitted by the frozen glob are supplied with full text and hashes. Fragments use original byte offsets before redaction.",
      generations,
      retainedRotations,
      fragments,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(JSON.stringify({ trials: fragments.length }));
