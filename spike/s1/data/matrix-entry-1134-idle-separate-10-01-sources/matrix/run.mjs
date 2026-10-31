import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  cpSync,
  mkdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { buildMatrixRunner } from "./runner.mjs";
import { buildMatrixBounded } from "./bounded.mjs";
import { pathToFileURL } from "node:url";

const source = resolve(import.meta.dirname, "..");
const output = resolve(process.argv[2] ?? "spike/s1/data/matrix-entry.json");
const sources = output.replace(/\.json$/, "") + "-sources";
assert.ok(
  !existsSync(output) && !existsSync(sources),
  "choose unused result and source paths",
);
assert.ok(!process.env.S1_GATE, "matrix selects its own retained gate");
assert.ok(
  !process.env.S1_DIAG_ONLY &&
    !process.env.S1_TRACE &&
    !process.env.S1_BINDINGS,
  "matrix does not accept diagnostic overrides",
);
const options = {
  row: process.env.S1_MATRIX_ROW ?? "entry-exit",
  version: process.env.S1_MATRIX_VERSION,
  affinity: process.env.S1_AFFINITY ?? "same",
  editContext: process.env.S1_EDIT_CONTEXT !== "false",
};
assert.ok(
  process.env.S1_EDIT_CONTEXT === undefined ||
    ["true", "false"].includes(process.env.S1_EDIT_CONTEXT),
);
const baseline = readFileSync(join(source, "run.mjs"));
const temporary = mkdtempSync(join(tmpdir(), "s1-matrix-runner-"));
const bounded = join(temporary, "bounded-gates.mjs");
writeFileSync(
  bounded,
  buildMatrixBounded(readFileSync(join(source, "bounded-gates.mjs"))),
);
const generated = buildMatrixRunner(
  baseline,
  source,
  options,
  pathToFileURL(bounded).href,
);
const script = join(temporary, "run.mjs");
writeFileSync(script, generated.code);
mkdirSync(sources, { recursive: true });
// Snapshot before launch: a concurrent edit must never erase the source of a run.
for (const name of [
  "run.mjs",
  "bounded-gates.mjs",
  "matrix",
  "leader",
  "probe",
  "load",
  "ready",
  "dock",
])
  cpSync(join(source, name), join(sources, name), { recursive: true });
writeFileSync(
  join(sources, "matrix-options.json"),
  JSON.stringify(
    { ...options, runnerBaselineSha256: generated.baselineSha256 },
    null,
    2,
  ) + "\n",
);
const child = spawn(process.execPath, [script, output], {
  env: { ...process.env, S1_GATE: options.row },
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
const status = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});
process.exitCode = status;
