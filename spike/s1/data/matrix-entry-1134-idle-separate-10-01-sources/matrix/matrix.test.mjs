import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { observe } from "./observe.cjs";
import { matrixLeader, matrixProbe } from "./install.mjs";
import { buildMatrixRunner } from "./runner.mjs";
import { buildMatrixBounded } from "./bounded.mjs";

test("engine changes during a cross-host observation reject stability", async () => {
  let cursor = 0;
  const read = () => ({ cursor });
  const sample = await observe(read, async () => {
    cursor = 1;
    return { active: false };
  });
  assert.equal(sample.matrixObservation.engineStable, false);
  assert.equal(sample.cursor, 1);
  assert.notEqual(
    sample.matrixObservation.beforeSha256,
    sample.matrixObservation.afterSha256,
  );
  const stable = await observe(read, async () => ({ active: false }));
  assert.equal(stable.matrixObservation.engineStable, true);
});

test("matrix observation hooks preserve leader input code and reject a changed baseline", () => {
  const source = readFileSync(
    new URL("../leader/extension.cjs", import.meta.url),
  );
  const generated = matrixLeader(source);
  const boundary = source.toString().indexOf("exports.activate");
  assert.equal(
    generated.slice(0, boundary),
    source.toString().slice(0, boundary),
  );
  new vm.Script(generated);
  assert.throws(
    () => matrixLeader(Buffer.concat([source, Buffer.from("\n")])),
    /retained scoped/,
  );
  const probe = matrixProbe(
    readFileSync(new URL("../probe/extension.cjs", import.meta.url)),
  );
  new vm.Script(probe);
  assert.ok(probe.includes("await leader?.clearEvents()"));
  assert.ok(!probe.includes('.getExtension("vim-companion-spike.s1-leader")'));
});

test("matrix wrapper validates versions and host choice without changing historical gates", () => {
  const root = resolve(import.meta.dirname, "..");
  const baseline = readFileSync(join(root, "run.mjs"));
  for (const version of ["1.134.0", "1.141.0"]) {
    for (const affinity of ["same", "separate"]) {
      const { code } = buildMatrixRunner(baseline, root, {
        version,
        affinity,
        editContext: true,
      });
      const directory = mkdtempSync(join(tmpdir(), "s1-matrix-syntax-"));
      const file = join(directory, "runner.mjs");
      writeFileSync(file, code);
      execFileSync(process.execPath, ["--check", file]);
      assert.ok(
        code.includes('"diagnostic must keep the original leader handlers"'),
      );
      assert.ok(code.includes('"only entry-document cleanup may change"'));
      assert.ok(code.includes("value.matrixObservation.engineStable"));
    }
  }
  assert.throws(() =>
    buildMatrixRunner(baseline, root, {
      version: "latest",
      affinity: "same",
      editContext: true,
    }),
  );
  assert.throws(() =>
    buildMatrixRunner(baseline, root, {
      version: "1.134.0",
      affinity: "unknown",
      editContext: true,
    }),
  );
});
test("loaded cancellation preserves the retained assertions and adds measured phase jitter", () => {
  const source = readFileSync(
    new URL("../bounded-gates.mjs", import.meta.url),
    "utf8",
  );
  const generated = buildMatrixBounded(source);
  assert.ok(
    generated.includes(
      "const phaseDelayMs = matrixPhase ? await matrixPhase() : 0;",
    ),
  );
  assert.ok(generated.includes("diagnostic ? 20 : baseline ? 2 : 1000"));
  assert.ok(
    generated.includes('"companion cancel rule did not end the leader"'),
  );
  assert.ok(generated.includes("        phaseDelayMs,"));
  assert.equal(
    generated.slice(
      generated.indexOf("      const after = await settled();"),
      generated.indexOf("      result.trials.push"),
    ),
    source.slice(
      source.indexOf("      const after = await settled();"),
      source.indexOf("      result.trials.push"),
    ),
  );
});
