import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildMatrixBounded } from "./bounded.mjs";

test("an individually selected native variant compares against its matching reference", async () => {
  const code = buildMatrixBounded(
    readFileSync(new URL("../bounded-gates.mjs", import.meta.url)),
  );
  const { runBoundedGate } = await import(
    "data:text/javascript;base64," + Buffer.from(code).toString("base64")
  );
  const text = "alpha beta\ndelta epsilon\n";
  const before = {
    viewColumn: 2,
    text,
    selections: [[0, 0, 0, 0]],
    mode: 0,
    pending: {},
    registers: {},
    leader: { active: false, events: [] },
    sentinel: "normal-editor-capture-off",
    sentinelSequence: 0,
  };
  const expected = (key) => ({
    ...structuredClone(before),
    text:
      key === "r" ? " " + text.slice(1) : key === "d" ? text.slice(1) : text,
    selections: key === "f" ? [[0, 5, 0, 5]] : [[0, 0, 0, 0]],
    registers:
      key === "d"
        ? {
            "-": [{ text: "a", mode: "character" }],
            '"': [{ text: "a", mode: "character" }],
          }
        : {},
  });
  const reference = {
    gate: "native-baseline",
    status: "native-baseline-recorded",
    node: "fixture",
    product: {},
    vimBundleSha256: "fixture",
    condition: {},
    settings: {},
  };
  const root = mkdtempSync(join(tmpdir(), "s1-native-case-test-"));
  try {
    const file = join(root, "reference.json");
    for (const key of ["r", "d"]) {
      reference.cases = [{ id: key + "-space", keys: [key, "space"] }];
      reference.trials = [0, 1].map((round) => ({
        round,
        case: key + "-space",
        before: {
          ...before,
          registers: round ? expected(key).registers : before.registers,
        },
        after: expected(key),
      }));
      writeFileSync(file, JSON.stringify(reference));
      for (const gate of ["native-baseline", "native"]) {
        let state = structuredClone(before),
          sequence = 0;
        const result = {
          node: "fixture",
          product: {},
          vimBundleSha256: "fixture",
          condition: {},
          settings: {},
          trials: [],
        };
        await runBoundedGate({
          gate,
          result,
          reference,
          referencePath: file,
          matrixCase: key + "-space",
          matrixPhase: async () => 0,
          text,
          noPending: () => true,
          save() {},
          call: async () => {
            state = { ...structuredClone(before), registers: state.registers };
          },
          settled: async () => ({
            ...structuredClone(state),
            sentinelSequence: sequence,
          }),
          inject: (keys) => {
            if (keys[0] === "ctrl+alt+9") sequence++;
            else {
              assert.deepEqual(keys, [key, "space"]);
              state = expected(key);
            }
          },
        });
        assert.equal(
          result.status,
          gate === "native" ? "native-gate-passed" : "native-baseline-recorded",
        );
        assert.equal(result.trials.length, gate === "native" ? 1000 : 2);
        assert.ok(
          result.trials.every(
            (trial) => trial.case === key + "-space" && !trial.errors.length,
          ),
        );
      }
    }
  } finally {
    rmSync(root, { recursive: true });
  }
});
