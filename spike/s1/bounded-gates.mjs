import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const equal = (a, b) => {
  try {
    assert.deepEqual(a, b);
    return true;
  } catch {
    return false;
  }
};
export const engineState = (s) => ({
  viewColumn: s.viewColumn,
  text: s.text,
  selections: s.selections,
  mode: s.mode,
  pending: s.pending,
  registers: s.registers,
});

export async function runBoundedGate({
  gate,
  result,
  reference,
  referencePath,
  call,
  inject,
  settled,
  noPending,
  save,
  text,
}) {
  const native = gate.startsWith("native");
  const baseline = gate === "native-baseline";
  const boundary = gate === "cancel-boundary";
  const availableCases = native
    ? ["f", "r", "d"].map((key) => ({
        id: `${key}-space`,
        keys: [key, "space"],
      }))
    : [[], ["w"]].flatMap((prefix) =>
        [
          ["Escape", "escape"],
          ["ctrl+bracketleft", "ctrl+["],
          ["ctrl+c", "ctrl+c"],
        ].map(([chord, reason]) => ({
          id: `${prefix.length ? "w" : "root"}-${reason}`,
          keys: ["space", ...prefix, chord, "j"],
          received: [...prefix, reason],
          reason,
        })),
      );
  const cases =
    gate === "cancel-release" || boundary
      ? ["root-ctrl+c", "root-escape"].map((id) =>
          availableCases.find((variant) => variant.id === id),
        )
      : availableCases;
  if (reference) {
    assert.equal(reference.gate, "native-baseline");
    assert.equal(reference.status, "native-baseline-recorded");
    assert.equal(reference.trials.length, 6);
    assert.equal(reference.node, result.node);
    assert.deepEqual(reference.product, result.product);
    assert.equal(reference.vimBundleSha256, result.vimBundleSha256);
    assert.deepEqual(reference.condition, result.condition);
    const settings = { ...result.settings };
    delete settings["vim.normalModeKeyBindingsNonRecursive"];
    delete settings["vim.visualModeKeyBindingsNonRecursive"];
    assert.deepEqual(reference.settings, settings);
    assert.deepEqual(
      engineState(reference.trials[2].after),
      engineState(reference.trials[5].after),
    );
    result.reference = {
      file: basename(referencePath),
      sha256: createHash("sha256")
        .update(readFileSync(referencePath))
        .digest("hex"),
      sourceCommit: reference.sourceCommit,
    };
  }
  const rounds = boundary ? 20 : baseline ? 2 : 1000;
  result.cases = cases;
  for (let round = 0; round < rounds; round++) {
    for (const [caseIndex, variant] of cases.entries()) {
      if (native) {
        await call("text", { value: text });
        await settled();
      }
      await call("prepare");
      const prepared = await settled();
      inject(["ctrl+alt+9"]);
      const before = await settled();
      result.lastPreparation = { round, case: variant.id, prepared, before };
      assert.equal(before.sentinelSequence, prepared.sentinelSequence + 1);
      assert.equal(before.sentinel, "normal-editor-capture-off");
      assert.equal(before.viewColumn, 2);
      assert.equal(before.mode, 0);
      assert.ok(noPending(before));
      assert.ok(!before.leader?.active);
      assert.deepEqual(before.selections, [[0, 0, 0, 0]]);
      assert.equal(before.text, text);
      const expected = reference?.trials[Math.min(round, 1) * 3 + caseIndex];
      if (expected) {
        assert.equal(expected.case, variant.id);
        assert.deepEqual(
          engineState(before),
          engineState(expected.before),
          "baseline precondition differs",
        );
      }
      const entry = boundary ? await confirmCapture(before) : undefined;
      const keys = boundary ? variant.keys.slice(1) : variant.keys;
      const injectedAt = Date.now();
      inject(keys);
      const injectionFinishedAt = Date.now();
      const after = await settled();
      inject(["ctrl+alt+9"]);
      const sentinel = await settled();
      const errors = [];
      const check = (ok, message) => {
        if (!ok) errors.push(message);
      };
      check(
        equal(engineState(after), engineState(sentinel)) &&
          equal(after.leader, sentinel.leader),
        "state changed before final sentinel",
      );
      check(
        !after.leader?.active &&
          sentinel.sentinel === "normal-editor-capture-off" &&
          sentinel.sentinelSequence === after.sentinelSequence + 1,
        "capture/focus was not released",
      );
      check(
        after.mode === 0 && noPending(after),
        "mode or pending input changed",
      );
      check(after.viewColumn === 2, "right editor lost focus");
      if (native) {
        check(
          !after.leader?.events.length,
          "native argument started or reached the leader",
        );
        if (baseline) {
          const expectedText =
            variant.id === "r-space"
              ? ` ${text.slice(1)}`
              : variant.id === "d-space"
                ? text.slice(1)
                : text;
          check(
            after.text === expectedText,
            "engine-only native text effect differs",
          );
          check(
            equal(
              after.selections,
              variant.id === "f-space" ? [[0, 5, 0, 5]] : [[0, 0, 0, 0]],
            ),
            "engine-only native cursor effect differs",
          );
          if (variant.id === "f-space")
            check(
              equal(after.registers, before.registers),
              "engine-only find changed registers",
            );
          if (variant.id === "d-space")
            check(
              equal(after.registers["-"], [{ text: "a", mode: "character" }]),
              "engine-only delete register differs",
            );
        }
        if (expected)
          check(
            equal(engineState(after), engineState(expected.after)),
            "engine state differs from engine-only reference",
          );
      } else {
        const events = after.leader.events;
        check(
          equal(
            events.map((e) => e.type),
            [
              "start",
              "context-on",
              ...variant.received.map(() => "key"),
              "end",
            ],
          ),
          "unexpected leader event sequence",
        );
        check(
          equal(
            events
              .filter((e) => e.type === "key")
              .map((e) => [e.value, e.active]),
            variant.received.map((key) => [key, true]),
          ),
          "leader did not receive exactly the prefix and cancel",
        );
        check(
          equal(
            events.filter((e) => e.type === "end").map((e) => e.reason),
            [variant.reason],
          ),
          "companion cancel rule did not end the leader",
        );
        check(after.text === before.text, "buffer changed");
        check(equal(after.registers, before.registers), "registers changed");
        check(
          equal(after.selections, [[1, 0, 1, 0]]),
          "j did not move down once in right editor",
        );
      }
      result.trials.push({
        index: result.trials.length,
        round,
        case: variant.id,
        keys: variant.keys,
        ...(boundary ? { entry, cancellationKeys: keys } : {}),
        injectedAt,
        injectionFinishedAt,
        before,
        after,
        finalSentinel: sentinel.sentinel,
        finalSentinelSequence: sentinel.sentinelSequence,
        errors,
      });
      if (errors.length) {
        result.status = "discrepancy";
        console.log(
          `Stopped at ${variant.id}, round ${round + 1}: ${errors.join("; ")}`,
        );
        save();
        if (!baseline && !boundary) {
          try {
            await recoveryDiagnostic(after);
          } catch (error) {
            result.recoveryDiagnosticError = String(error);
          }
        }
        return;
      }
    }
    if ((round + 1) % 100 === 0 || baseline) {
      save();
      console.log(
        `${round + 1}/${rounds} rounds recorded (${cases.length} cases)`,
      );
    }
  }
  if (baseline) {
    assert.deepEqual(
      engineState(result.trials[2].after),
      engineState(result.trials[5].after),
      "reference did not reach a repeatable state",
    );
  }
  result.status = boundary
    ? "cancel-boundary-diagnostic-complete"
    : baseline
      ? "native-baseline-recorded"
      : `${gate}-gate-passed`;

  async function confirmCapture(before) {
    const entry = { startedAt: Date.now(), samples: [] };
    result.lastEntry = entry;
    const deadline = entry.startedAt + 1000;
    let previous = before;
    do {
      const injectedAt = Date.now();
      // The first sentinel follows SPC at the requested input interval. Later
      // sentinels only observe readiness; none runs between cancel and j.
      inject(entry.samples.length ? ["ctrl+alt+9"] : ["space", "ctrl+alt+9"]);
      const injectionFinishedAt = Date.now();
      let observed;
      do {
        observed = await call("snapshot");
        if (observed.sentinelSequence !== previous.sentinelSequence) break;
        await sleep(5);
      } while (Date.now() < deadline);
      entry.samples.push({
        injectedAt,
        injectionFinishedAt,
        observedAt: Date.now(),
        observed,
      });
      assert.equal(
        observed.sentinelSequence,
        previous.sentinelSequence + 1,
        "entry sentinel was not received exactly once within 1000 ms",
      );
      assert.ok(
        ["normal-editor-capture-on", "normal-editor-capture-off"].includes(
          observed.sentinel,
        ),
        "entry sentinel lost Normal editor focus",
      );
      assert.deepEqual(
        engineState(observed),
        engineState(before),
        "entry/sentinel changed engine state",
      );
      if (observed.sentinel === "normal-editor-capture-on") {
        assert.ok(observed.leader.active);
        assert.ok(
          Date.now() <= deadline,
          "entry confirmation exceeded 1000 ms",
        );
        entry.confirmedAt = Date.now();
        return entry;
      }
      previous = observed;
    } while (Date.now() < deadline);
    throw new Error(
      "Renderer capture was not confirmed within 1000 ms; cancellation was not injected",
    );
  }

  async function recoveryDiagnostic(failed) {
    const recovery = {
      scope: "Single diagnostic after a failed trial; not fault qualification",
    };
    result.recoveryDiagnostic = recovery;
    if (failed.leader.active) {
      const deadline = Date.now() + 6500;
      recovery.watchdogSamples = [];
      let s;
      do {
        await sleep(100);
        s = await call("snapshot");
        recovery.watchdogSamples.push({
          at: Date.now(),
          active: s.leader.active,
        });
      } while (s.leader.active && Date.now() < deadline);
      recovery.afterWatchdog = s;
    }
    // Preserve the failed engine state. Reset releases capture; it does not repair Vim input.
    recovery.beforeReset = await call("snapshot");
    await call("reset");
    recovery.afterReset = await settled();
    inject(["ctrl+alt+9"]);
    recovery.resetSentinel = await settled();
    inject(["j"]);
    recovery.afterJ = await settled();
    // Only attempt a fresh cycle from a confirmed idle Normal engine.
    if (
      recovery.afterJ.mode === 0 &&
      noPending(recovery.afterJ) &&
      !recovery.afterJ.leader.active
    ) {
      await call("prepare");
      recovery.beforeFreshCycle = await settled();
      inject(["space", "w", "Escape", "j"]);
      recovery.afterFreshCycle = await settled();
      inject(["ctrl+alt+9"]);
      recovery.freshCycleSentinel = await settled();
      // Exercise reset while a real prefix is active, separately from the cancellation cycle.
      await call("prepare");
      await settled();
      inject(["space", "w"]);
      recovery.activePrefix = await settled();
      if (recovery.activePrefix.leader.active) {
        await call("reset");
        recovery.activeReset = await settled();
        inject(["j"]);
        recovery.activeResetJ = await settled();
        inject(["ctrl+alt+9"]);
        recovery.activeResetSentinel = await settled();
      }
    }
  }
}
