import assert from "node:assert/strict";

// The retained idle-only gate has no phase randomization. Matrix runs add it
// before each measured injection without changing its checks or trial counts.
export function buildMatrixBounded(source) {
  let code = source.toString();
  const replace = (before, after) => {
    assert.equal(
      code.split(before).length,
      2,
      "bounded matrix hook must be unique",
    );
    code = code.replace(before, after);
  };
  replace("  text,\n}) {", "  text,\n  matrixPhase,\n  matrixCase,\n}) {");
  replace("  const cases =", "  let cases =");
  replace(
    "  if (reference) {",
    `  if (matrixCase) {
    assert.ok(["cancel", "native", "native-baseline"].includes(gate));
    cases = cases.filter((variant) => variant.id === matrixCase);
    assert.equal(cases.length, 1, "unknown bounded case");
  }
  if (reference) {`,
  );
  replace(
    "const expected = reference?.trials[Math.min(round, 1) * 3 + caseIndex];",
    "const expected = reference?.trials.find((trial) => trial.round === Math.min(round, 1) && trial.case === variant.id);",
  );
  replace(
    "    assert.equal(reference.trials.length, 6);",
    '    assert.deepEqual(reference.cases, cases, "reference must use the same native case order");\n    assert.equal(reference.trials.length, 2 * cases.length);',
  );
  replace(
    "engineState(reference.trials[2].after),\n      engineState(reference.trials[5].after),",
    "engineState(reference.trials[cases.length - 1].after),\n      engineState(reference.trials[2 * cases.length - 1].after),",
  );
  replace(
    "engineState(result.trials[2].after),\n      engineState(result.trials[5].after),",
    "engineState(result.trials[cases.length - 1].after),\n      engineState(result.trials[2 * cases.length - 1].after),",
  );
  replace(
    "      const keys = boundary ? variant.keys.slice(1) : variant.keys;\n      const injectedAt = Date.now();",
    `      const keys = boundary ? variant.keys.slice(1) : variant.keys;
      const phaseDelayMs = matrixPhase ? await matrixPhase() : 0;
      const injectedAt = Date.now();`,
  );
  replace(
    "        index: result.trials.length,",
    "        index: result.trials.length,\n        phaseDelayMs,",
  );
  replace(
    "        finalSentinel: sentinel.sentinel,",
    "        finalSnapshot: sentinel,\n        finalSentinel: sentinel.sentinel,",
  );
  return code;
}
