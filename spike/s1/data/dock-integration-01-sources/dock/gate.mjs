import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { engineState } from "../bounded-gates.mjs";

export const dockCases = [
  { id: "unresolved-leaf", visible: false, prefix: true, leaf: true },
  { id: "visible-root-escape", visible: true, prefix: false, cancel: "escape" },
  {
    id: "visible-prefix-ctrl+c",
    visible: true,
    prefix: true,
    cancel: "ctrl+c",
  },
  { id: "visible-prefix-leaf", visible: true, prefix: true, leaf: true },
  {
    id: "vim-reference-prefix-escape",
    visible: true,
    prefix: true,
    cancel: "escape",
    tab: "vim",
  },
  {
    id: "hidden-prefix-escape",
    visible: false,
    prefix: true,
    cancel: "escape",
    tab: "vim",
  },
];

export async function runDockGate({
  result,
  call,
  inject,
  settled,
  noPending,
  save,
  text,
  observer,
}) {
  result.cases = dockCases;
  const timedInject = (keys) => {
    const value = { keys, started: performance.now() };
    inject(keys);
    value.finished = performance.now();
    return value;
  };
  async function waitFor(predicate, start, record) {
    record.started = start;
    record.samples = [];
    do {
      const snapshot = await call("snapshot");
      record.samples.push({ t: performance.now(), dock: snapshot.leader.dock });
      assert.deepEqual(snapshot.leader.dock.violations, []);
      if (predicate(snapshot)) {
        record.finished = performance.now();
        return snapshot;
      }
      await sleep(20);
    } while (performance.now() - start < 1000);
    throw new Error("dock state observation exceeded 1000 ms");
  }
  async function observe(trial, name, expected, injection, visible, tab) {
    const record = (trial.observations[name] = {});
    const start = injection?.finished ?? performance.now();
    const snapshot = await waitFor(
      (s) => {
        const dock = s.leader.dock;
        if (dock.visible !== visible || !expected(s)) return false;
        if (!visible) return true;
        const applied = dock.applied;
        return (
          applied &&
          applied.revision === dock.state.revision &&
          applied.tab === tab &&
          (!trial.case.tab || applied.topic === "objects")
        );
      },
      start,
      record,
    );
    record.snapshot = snapshot;
    record.image = {};
    await observer.observe(
      record.image,
      visible,
      `${String(trial.index + 1).padStart(2, "0")}-${name}`,
      start,
    );
    return snapshot;
  }
  async function sentinel(trial, name, expected, baseline) {
    const injection = timedInject(["ctrl+alt+9"]);
    trial.injections[name] = injection;
    const current = await settled();
    trial[name] = current;
    assert.equal(current.sentinelSequence, baseline.sentinelSequence + 1);
    assert.equal(current.sentinel, expected);
    assert.deepEqual(engineState(current), engineState(baseline));
    return current;
  }
  for (const [index, variant] of dockCases.entries()) {
    const trial = {
      index,
      case: variant,
      observations: {},
      injections: {},
      errors: [],
    };
    result.trials.push(trial);
    let phase = "setup";
    try {
      if (index === 1) await call("dock", { action: "select", tab: "leader" });
      if (index === 4)
        await call("dock", { action: "select", tab: "vim", topic: "objects" });
      if (index === 5) await call("dock", { action: "hide" });
      await call("prepare");
      const prepared = await settled();
      const before = await sentinel(
        trial,
        "before",
        "normal-editor-capture-off",
        prepared,
      );
      assert.equal(before.viewColumn, 2);
      assert.equal(before.text, text);
      assert.equal(before.mode, 0);
      assert.ok(noPending(before));
      assert.deepEqual(before.selections, [[0, 0, 0, 0]]);
      assert.equal(before.leader.active, false);
      if (index === 0) assert.equal(before.leader.dock.resolutions, 0);
      const tab = variant.tab ?? "leader";
      await observe(
        trial,
        "before",
        (s) => s.leader.dock.state.phase === "idle",
        null,
        variant.visible,
        tab,
      );
      phase = "entry";
      const entryInjection = (trial.injections.entry = timedInject(["space"]));
      const entry = await observe(
        trial,
        "root",
        (s) =>
          s.leader.active &&
          s.leader.dock.state.phase === "active" &&
          s.leader.prefix.length === 0,
        entryInjection,
        variant.visible,
        tab,
      );
      trial.session = entry.leader.dock.state.session;
      assert.deepEqual(engineState(entry), engineState(before));
      let current = await sentinel(
        trial,
        "entrySentinel",
        "normal-editor-capture-on",
        entry,
      );
      assert.equal(current.leader.dock.state.session, trial.session);
      if (variant.prefix) {
        phase = "prefix";
        const prefixInjection = (trial.injections.prefix = timedInject(["w"]));
        trial.entryPauseMs = prefixInjection.started - entryInjection.finished;
        const prefix = await observe(
          trial,
          "prefix",
          (s) =>
            s.leader.active &&
            s.leader.prefix.join(" ") === "w" &&
            s.leader.dock.state.prefix.join(" ") === "w" &&
            s.leader.dock.state.session === trial.session,
          prefixInjection,
          variant.visible,
          tab,
        );
        assert.deepEqual(engineState(prefix), engineState(before));
        current = await sentinel(
          trial,
          "prefixSentinel",
          "normal-editor-capture-on",
          prefix,
        );
        assert.equal(current.leader.dock.state.session, trial.session);
      }
      phase = "suffix";
      const suffix = (trial.injections.suffix = timedInject([
        variant.leaf ? "h" : variant.cancel === "escape" ? "Escape" : "ctrl+c",
        "j",
      ]));
      trial.lastObservationPauseMs =
        suffix.started - (trial.injections.prefix ?? entryInjection).finished;
      const after = await observe(
        trial,
        "after",
        (s) => !s.leader.active && s.leader.dock.state.phase === "idle",
        suffix,
        variant.visible,
        tab,
      );
      const settledAfter = await settled();
      trial.after = settledAfter;
      phase = "final-assertions";
      assert.equal(settledAfter.text, before.text);
      assert.deepEqual(settledAfter.registers, before.registers);
      assert.equal(settledAfter.mode, 0);
      assert.ok(noPending(settledAfter));
      assert.equal(settledAfter.viewColumn, variant.leaf ? 1 : 2);
      assert.deepEqual(settledAfter.selections, [[1, 0, 1, 0]]);
      const keys = [
        ...(variant.prefix ? ["w"] : []),
        variant.leaf ? "h" : variant.cancel,
      ];
      const events = settledAfter.leader.events;
      assert.deepEqual(
        events
          .filter((event) => event.type === "key")
          .map((event) => [event.value, event.active]),
        keys.map((key) => [key, true]),
      );
      assert.deepEqual(
        events
          .filter((event) => event.type === "end")
          .map((event) => event.reason),
        [variant.leaf ? "leaf" : variant.cancel],
      );
      assert.deepEqual(
        events.map((event) => event.type),
        [
          "start",
          "context-on",
          ...keys.map(() => "key"),
          "end",
          ...(variant.leaf ? ["leaf-start", "leaf-end"] : []),
        ],
      );
      if (variant.leaf)
        assert.equal(
          events.find((event) => event.type === "leaf-start").command,
          "workbench.action.focusLeftGroup",
        );
      await sentinel(trial, "final", "normal-editor-capture-off", settledAfter);
      phase = "post-trial-view";
      if (index === 0 || index === 5) {
        const reveal = { started: performance.now() };
        await call("dock", { action: "show" });
        reveal.finished = performance.now();
        trial.reveal = reveal;
        await observe(
          trial,
          "reopened",
          (s) => s.leader.dock.state.phase === "idle",
          reveal,
          true,
          tab,
        );
      }
      if (index === 4 || index === 5) {
        const selected = { started: performance.now() };
        await call("dock", { action: "select", tab: "leader" });
        selected.finished = performance.now();
        await observe(
          trial,
          "leader-idle",
          (s) => s.leader.dock.state.phase === "idle",
          selected,
          true,
          "leader",
        );
        // Keep the user's reference selection for the following hidden case.
        if (index === 4)
          await call("dock", {
            action: "select",
            tab: "vim",
            topic: "objects",
          });
      }
    } catch (error) {
      trial.errors.push(String(error));
      trial.stoppedPhase = phase;
      try {
        trial.stopped = await call("snapshot");
      } catch (snapshotError) {
        trial.snapshotError = String(snapshotError);
      }
      result.status = "dock-integration-discrepancy";
      save();
      return;
    }
    save();
  }
  result.status = "dock-integration-awaiting-image-review";
}
