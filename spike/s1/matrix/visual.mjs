import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { engineState } from "../bounded-gates.mjs";

// VSCodeVim 1.32.4 src/mode/mode.ts: Visual=2, VisualBlock=3, VisualLine=4.
const cases = [
  { id: "character", key: "v", mode: 2 },
  { id: "line", key: "V", mode: 4 },
  { id: "block", key: "ctrl+v", mode: 3 },
];
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export async function runVisual({
  result,
  call,
  inject,
  settled,
  noPending,
  save,
  phase,
  referencePath,
}) {
  const baseline = result.gate === "visual-baseline";
  const text = "alpha beta\ndelta epsilon\neta theta\n";
  let reference;
  if (!baseline) {
    assert.ok(
      referencePath,
      "Visual requires a companion-free selection reference",
    );
    const bytes = readFileSync(referencePath);
    reference = JSON.parse(bytes);
    assert.equal(reference.status, "visual-baseline-recorded");
    assert.deepEqual(reference.product, result.product);
    assert.equal(reference.vimBundleSha256, result.vimBundleSha256);
    assert.deepEqual(reference.condition, result.condition);
    const settings = { ...result.settings };
    delete settings["vim.normalModeKeyBindingsNonRecursive"];
    delete settings["vim.visualModeKeyBindingsNonRecursive"];
    assert.deepEqual(reference.settings, settings);
    assert.equal(reference.trials.length, 6);
    result.reference = {
      file: basename(referencePath),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }
  const selectedCases = result.matrix.case
    ? cases.filter((item) => item.id === result.matrix.case)
    : cases;
  assert.ok(selectedCases.length > 0);
  result.cases = selectedCases;
  result.referenceMethod =
    "Companion absent; invoke the same IDE leaf, await its settled state, then send j to establish the intended selection, without claiming a timing baseline";
  await call("text", { value: text });
  for (let round = 0; round < (baseline ? 2 : 1000); round++)
    for (const variant of selectedCases) {
      const caseIndex = cases.indexOf(variant);
      inject(["Escape"]);
      await settled();
      await call("prepare");
      await settled();
      inject([variant.key, "e", "e"]);
      const selected = await settled();
      assert.equal(selected.mode, variant.mode);
      assert.equal(selected.viewColumn, 2);
      assert.ok(noPending(selected));
      assert.equal(selected.text, text);
      assert.equal(selected.selectedText.length, 1);
      assert.equal(
        selected.selectedText[0].replace(/\n$/, ""),
        "alpha beta",
        "Visual must select both complete words",
      );
      assert.ok(
        (variant.id === "line"
          ? [[[0, 0, 0, 10]], [[0, 0, 1, 0]]]
          : [[[0, 0, 0, 10]]]
        ).some((selection) => equal(selection, selected.selections)),
        "Visual selection has unexpected boundaries",
      );
      inject(["ctrl+alt+9"]);
      const before = await settled();
      assert.equal(before.sentinel, "visual-editor-capture-off");
      assert.equal(before.sentinelSequence, selected.sentinelSequence + 1);
      assert.ok(!before.leader?.active);
      const expected = reference?.trials[Math.min(round, 1) * 3 + caseIndex];
      if (expected)
        assert.deepEqual(engineState(before), engineState(expected.before));
      const phaseDelayMs = await phase();
      const injectedAt = Date.now();
      if (baseline) {
        await call("command", { command: "workbench.action.focusLeftGroup" });
        await settled();
        inject(["j"]);
      } else inject(["space", "w", "h", "j"]);
      const injectionFinishedAt = Date.now();
      const after = await settled();
      inject(["ctrl+alt+9"]);
      const finalSnapshot = await settled();
      const errors = [];
      const check = (ok, message) => {
        if (!ok) errors.push(message);
      };
      check(
        after.viewColumn === 1,
        "Visual leaf did not focus the left editor",
      );
      check(
        after.text === before.text && equal(after.registers, before.registers),
        "Visual changed text/registers",
      );
      check(noPending(after), "Visual left pending input");
      check(
        after.selections.some((selection) => selection[2] === 1),
        "Visual j did not reach the next line",
      );
      check(
        equal(engineState(after), engineState(finalSnapshot)) &&
          equal(after.leader, finalSnapshot.leader),
        "Visual state changed before final sentinel",
      );
      check(
        finalSnapshot.sentinelSequence === after.sentinelSequence + 1 &&
          ["visual-editor-capture-off", "normal-editor-capture-off"].includes(
            finalSnapshot.sentinel,
          ) &&
          !after.leader?.active,
        "Visual capture/focus was not released",
      );
      if (!baseline) {
        check(
          after.leader.events.filter((event) => event.type === "leaf-end")
            .length === 1,
          "Visual leaf did not complete exactly once",
        );
        check(
          equal(
            after.leader.events
              .filter((event) => event.type === "key")
              .map((event) => event.value),
            ["w", "h"],
          ),
          "Visual leader sequence leaked",
        );
        check(
          equal(engineState(after), engineState(expected.after)),
          "Visual selection/state differs from the companion-free reference",
        );
      }
      result.trials.push({
        index: result.trials.length,
        round,
        case: variant.id,
        phaseDelayMs,
        injectedAt,
        injectionFinishedAt,
        before,
        after,
        finalSnapshot,
        errors,
      });
      if (errors.length) {
        result.status = "discrepancy";
        save();
        return;
      }
      if (
        variant === selectedCases.at(-1) &&
        ((round + 1) % 100 === 0 || baseline)
      ) {
        save();
        console.log(
          `${round + 1}/${baseline ? 2 : 1000} Visual rounds recorded`,
        );
      }
    }
  if (baseline)
    for (let i = 0; i < 3; i++) {
      assert.deepEqual(
        engineState(result.trials[i].before),
        engineState(result.trials[i + 3].before),
        "Visual reference preparation is not repeatable",
      );
      assert.deepEqual(
        engineState(result.trials[i].after),
        engineState(result.trials[i + 3].after),
        "Visual reference outcome is not repeatable",
      );
    }
  result.status = baseline ? "visual-baseline-recorded" : "visual-gate-passed";
}
