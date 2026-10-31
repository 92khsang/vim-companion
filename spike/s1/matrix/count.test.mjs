import test from "node:test";
import assert from "node:assert/strict";
import { countRegisterOracle, expectedCountRegisters } from "./count.mjs";
import { auditCountRegisters } from "./audit.mjs";

test("count tab transition validates both filename registers and preserves all other registers", () => {
  const fixture = {
    files: [
      "file://$S1_SANDBOX/workspace/sample.txt",
      "file://$S1_SANDBOX/workspace/count-1.txt",
    ],
  };
  const current = [{ text: "sample.txt", mode: "character" }];
  const alternate = [{ text: "count-1.txt", mode: "character" }];
  const before = {
    documentUri: fixture.files[0],
    registers: {
      "%": current,
      "#": alternate,
      '"': [{ text: "preserved yank", mode: "line" }],
      ".": [{ text: { keys: "iunchanged<Esc>" }, mode: "character" }],
    },
  };
  const expected = expectedCountRegisters(before, fixture);
  assert.deepEqual(expected, {
    ...before.registers,
    "%": alternate,
    "#": current,
  });
  assert.deepEqual(before.registers["%"], current);
  assert.notDeepEqual(expected, {
    ...expected,
    '"': [{ text: "lost", mode: "line" }],
  });
  assert.notDeepEqual(expected, { ...expected, "%": current });
  assert.notDeepEqual(expected, { ...expected, "#": alternate });
  assert.throws(
    () =>
      expectedCountRegisters(
        { ...before, registers: { ...before.registers, "#": current } },
        fixture,
      ),
    /alternate-file register differs/,
  );
  assert.throws(() =>
    expectedCountRegisters(
      { ...before, documentUri: fixture.files[1] },
      fixture,
    ),
  );
  const raw = {
    countFixture: { ...fixture, registerOracle: countRegisterOracle },
    trials: [{ before, after: { registers: expected }, errors: [] }],
  };
  assert.deepEqual(auditCountRegisters(raw), {
    method: countRegisterOracle,
    validatedTrials: 1,
  });
  raw.trials[0].after.registers = { ...expected, "%": current };
  assert.throws(() => auditCountRegisters(raw), /not recorded accurately/);
  raw.trials[0].errors.push(
    "count registers differ from the expected tab transition",
  );
  assert.equal(auditCountRegisters(raw).validatedTrials, 1);
  assert.throws(() => auditCountRegisters({ ...raw, countFixture: fixture }));
});
