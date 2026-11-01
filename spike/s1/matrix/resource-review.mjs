import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { resourceErrors } from "./resource-errors.mjs";

const [file, sandbox, output] = process.argv.slice(2);
assert.ok(
  file && sandbox && output,
  "usage: resource-review.mjs RAW.json OWNED_SANDBOX REVIEW.json",
);
const bytes = readFileSync(file);
const raw = JSON.parse(bytes);
assert.ok(
  raw.finished,
  "only finished raw runs can receive a final resource review",
);
const root = resolve(sandbox);
const check = resourceErrors(root);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const redact = (text) =>
  text.replaceAll(root, "$S1_SANDBOX").replaceAll(process.env.HOME, "$HOME");
const review = {
  rawSha256: hash(bytes),
  reviewedAt: new Date().toISOString(),
  classification: check.errors.length
    ? "resource-errors-present"
    : "no-resource-errors-observed",
  limitsAtReview: check.limits,
  files: Object.fromEntries(
    check.inspectedFiles.map((file) => [
      file,
      hash(readFileSync(join(root, file))),
    ]),
  ),
  errors: check.errors,
  qualification: check.errors.length
    ? "Retain raw observations but exclude this environment from qualification; repeat with clean resources."
    : "No matching errors in retained owned logs; other protocol, count and state checks remain required.",
};
writeFileSync(output, redact(JSON.stringify(review, null, 2)) + "\n", {
  flag: "wx",
});
console.log(
  JSON.stringify({
    classification: review.classification,
    errors: check.errors.length,
  }),
);
