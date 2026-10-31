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
  replace("  text,\n}) {", "  text,\n  matrixPhase,\n}) {");
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
  return code;
}
