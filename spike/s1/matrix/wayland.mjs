import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { engineState } from "../bounded-gates.mjs";
import { compositionDeadline } from "./hangul.mjs";

export const waylandCases = [
  "letter",
  "quick-open",
  "search",
  "shift-latin",
  "shift-hangul",
  "escape-plain",
  "escape-composed",
  "ctrl-bracket-plain",
  "ctrl-bracket-composed",
  "latin-entry",
  "latin-query",
];
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const symbol = (state) => state.inputMode?.symbol;
export async function runWayland({
  result,
  call,
  inject,
  settled,
  noPending,
  save,
  text,
  observer,
  native,
  until,
  check,
  phase,
}) {
  const kind = result.matrix.case;
  assert.ok(waylandCases.includes(kind));
  const mode = async (expected) => {
    const before = native.state();
    assert.equal(before.source, "ibus:hangul");
    assert.ok(
      ["EN", "한"].includes(symbol(before)),
      "IBus mode property missing",
    );
    if (symbol(before) !== expected) inject(["shift+space"]);
    return until(() => {
      const value = native.state();
      return symbol(value) === expected && value;
    }, "IBus mode switch was not observed");
  };
  await mode("EN");
  await call("text", { value: "" });
  await settled();
  // Calibration resets the shared document through the editor API. Refocus its
  // two views before requiring the native input buffer to match that document.
  await call("prepare");
  await settled();
  const proofStart = result.nativeSession.batches.length;
  const proof = (result.nativeCompositionProof = {
    initial: await observer.read(),
    pacing:
      "Calibration only: wait for the empty focused editor, then settle and observe each physical key. Measured case batches keep their requested inter-key delay.",
    steps: [],
  });
  inject(["i"]);
  await until(
    async () => (await call("snapshot")).mode === 1,
    "native Hangul calibration did not enter Insert",
  );
  proof.insert = await settled();
  await call("command", { command: "workbench.action.focusLeftGroup" });
  await call("text", { value: "" });
  proof.calibrationView = await settled();
  assert.equal(proof.calibrationView.viewColumn, 1);
  assert.equal(proof.calibrationView.mode, 1);
  assert.equal(proof.calibrationView.text, "");
  proof.ready = await until(async () => {
    const state = await observer.read();
    proof.lastReadiness = state;
    const context = state.editContexts.find((item) => item.focused);
    const input = state.inputs.find((item) => item.focused && item.editor);
    return (
      state.active?.editor &&
      (context ? context.text === "" : input?.value === "") &&
      state
    );
  }, "native Hangul calibration renderer did not reach the empty editor");
  const proofBefore = await observer.begin();
  proof.before = proofBefore;
  await mode("한");
  for (const key of ["g", "k", "s", "r", "m", "f", "shift+space"]) {
    const step = { key, requestedAt: performance.now() };
    proof.steps.push(step);
    inject([key]);
    step.snapshot = await settled();
    step.renderer = await observer.read();
    step.finishedAt = performance.now();
    save();
  }
  const composed = await settled(),
    proofAfter = await observer.read(),
    proofMode = native.state();
  result.nativeCompositionProof = {
    ...proof,
    before: proofBefore,
    after: proofAfter,
    snapshot: composed,
    mode: proofMode,
    batchRange: [proofStart, result.nativeSession.batches.length],
  };
  save();
  assert.equal(
    composed.text,
    "한글",
    "real IBus did not commit the Hangul calibration",
  );
  assert.equal(symbol(proofMode), "EN");
  assert.ok(
    proofAfter.events.some(
      (event) =>
        ["textupdate", "compositionupdate", "compositionend", "input"].includes(
          event.type,
        ) &&
        [event.text, event.data, event.contextText].some((value) =>
          /[한글]/.test(value ?? ""),
        ),
    ),
    "real composition target evidence is missing",
  );
  inject(["Escape"]);
  await settled();
  await call("text", { value: text });
  await call("prepare");
  await settled();
  const query = ["quick-open", "search", "latin-query"].includes(kind);
  const noLeaf = ["letter", "shift-hangul"].includes(kind);
  const cancel = kind.startsWith("escape-") || kind.startsWith("ctrl-bracket-");
  const initialMode = [
    "letter",
    "quick-open",
    "search",
    "shift-latin",
  ].includes(kind)
    ? "한"
    : "EN";
  const sequences = {
    letter: ["space", "g"],
    "quick-open": [
      "space",
      "space",
      "r",
      "k",
      "s",
      "k",
      "e",
      "k",
      "shift+space",
    ],
    search: ["space", "slash", "r", "k", "s", "k", "e", "k", "shift+space"],
    "shift-latin": ["space", "shift+space", "w", "h", "j"],
    "shift-hangul": ["space", "shift+space", "w", "h"],
    "latin-entry": ["space", "w", "h", "j"],
    "latin-query": ["space", "space", "a", "b", "c"],
  };
  const keys = sequences[kind] ?? [
    "space",
    "w",
    "shift+space",
    ...(kind.endsWith("composed") ? ["g"] : []),
    ...(kind.startsWith("escape-")
      ? ["Escape", "j"]
      : ["ctrl+bracketleft", "plus"]),
  ];
  result.nativeProtocol = {
    kind,
    initialMode,
    keys,
    input:
      "Persistent Mutter RemoteDesktop virtual keyboard; no CDP Input method",
    composition: noLeaf
      ? "Literal sequence leaves real preedit; record it without adding a committing key"
      : "Query calibration uses a recorded Shift+Space commit; cancel keys commit any existing preedit through real IBus",
    cancelPrefix: cancel
      ? "Form the w prefix in EN, then physically switch to Hangul before cancel"
      : null,
    watchdog: noLeaf
      ? "Observe 5500 ms after injection with no capture-off wait; compare the unchanged 5000 ms release deadline"
      : null,
  };
  for (let index = 0; index < 1000; index++) {
    check();
    await mode("EN");
    await call("prepare");
    await call("text", { value: text });
    const prepared = await settled();
    inject(["ctrl+alt+9"]);
    const before = await settled();
    assert.equal(before.sentinelSequence, prepared.sentinelSequence + 1);
    assert.equal(before.sentinel, "normal-editor-capture-off");
    assert.equal(before.mode, 0);
    assert.ok(noPending(before) && !before.leader.active);
    assert.equal(before.text, text);
    assert.deepEqual(before.selections, [[0, 0, 0, 0]]);
    const initial = await mode(initialMode);
    const rendererBefore = await observer.begin(),
      phaseDelayMs = await phase();
    const injectedAt = performance.now(),
      injection = inject(keys),
      injectionFinishedAt = performance.now();
    if (noLeaf) await sleep(5500);
    const after = await settled(),
      rendererAfter = await observer.read(),
      imeAfter = native.state();
    const errors = [],
      inconclusive = [],
      verify = (condition, message) => {
        if (!condition) errors.push(message);
      };
    verify(rendererAfter.overflow === 0, "native renderer event overflow");
    verify(
      imeAfter.focusClientType === 0 &&
        imeAfter.focusPid === result.nativeSession.focus.focusPid,
      "native Wayland IDE lost focus",
    );
    verify(
      after.text === text && equal(before.registers, after.registers),
      "native composition changed text/registers",
    );
    verify(
      after.mode === 0 && noPending(after),
      "native input left mode/pending changes",
    );
    const starts = after.leader.events.filter(
      (event) => event.type === "leaf-start",
    );
    const accepted = after.leader.events
      .filter((event) => event.type === "key")
      .map((event) => event.value);
    let deadline;
    if (noLeaf) {
      verify(
        starts.length === 0 && equal(accepted, []),
        "native composition dispatched a leader key/leaf",
      );
      verify(
        equal(engineState(before), engineState(after)),
        "native composition changed engine state",
      );
      deadline = compositionDeadline(after.leader.events);
      if (deadline.outcome === "fail")
        errors.push("native composition release exceeded 5000 ms");
      if (deadline.outcome === "inconclusive")
        inconclusive.push("native composition deadline is unproven");
    } else if (query) {
      const command =
        kind === "search"
          ? "workbench.action.findInFiles"
          : "workbench.action.quickOpen";
      verify(
        starts.length === 1 && starts[0].command === command,
        "native query leaf differs",
      );
      verify(
        equal(accepted, [kind === "search" ? "/" : "space"]),
        "native query leader keys leaked",
      );
      const focused = rendererAfter.inputs.filter((input) => input.focused),
        expected = kind === "latin-query" ? "abc" : "가나다";
      verify(
        focused.length === 1 &&
          focused[0].value === expected &&
          (kind === "search" ? focused[0].searchQuery : focused[0].quickInput),
        "native query missed its focused target",
      );
      verify(
        equal(engineState(before), engineState(after)),
        "native query changed engine state",
      );
    } else if (cancel) {
      const expected = kind.startsWith("escape-") ? "escape" : "ctrl+[";
      verify(
        starts.length === 0 && equal(accepted, ["w", expected]),
        "native cancel did not use the companion rule",
      );
      verify(
        after.leader.events.some(
          (event) => event.type === "end" && event.reason === expected,
        ),
        "native cancel did not release capture",
      );
      verify(
        after.viewColumn === 2 && equal(after.selections, [[1, 0, 1, 0]]),
        "native post-cancel key did not move down",
      );
    } else {
      verify(
        starts.length === 1 &&
          starts[0].command === "workbench.action.focusLeftGroup",
        "native left-group leaf did not run once",
      );
      verify(equal(accepted, ["w", "h"]), "native leader sequence leaked");
      verify(
        after.viewColumn === 1 && equal(after.selections, [[1, 0, 1, 0]]),
        "native first j did not reach the left editor",
      );
    }
    verify(!after.leader.active, "native capture remains active");
    if (
      noLeaf ||
      (query && kind !== "latin-query") ||
      kind.endsWith("composed")
    ) {
      const expected = kind === "shift-hangul" ? "조" : query ? "다" : "ㅎ";
      if (
        !rendererAfter.events.some((event) =>
          [event.text, event.data, event.contextText].some((value) =>
            value?.includes(expected),
          ),
        )
      )
        inconclusive.push(
          "native per-trial preedit/commit target evidence missing",
        );
    }
    const trial = {
      index,
      case: kind,
      initial,
      phaseDelayMs,
      injectedAt,
      injectionFinishedAt,
      injection,
      before,
      after,
      renderer: { before: rendererBefore, after: rendererAfter },
      imeAfter,
      deadline,
      errors,
      inconclusive,
    };
    result.trials.push(trial);
    save();
    if (query) {
      inject(["Escape"]);
      if (kind === "search")
        await call("command", {
          command: "workbench.action.focusActiveEditorGroup",
        });
      trial.dismissed = await settled();
      verify(
        equal(engineState(after), engineState(trial.dismissed)),
        "native query cleanup changed engine state",
      );
    }
    // Capture the post-sequence state before any IME cleanup can commit preedit.
    inject(["ctrl+alt+9"]);
    trial.finalSnapshot = await settled();
    const comparison = trial.dismissed ?? after;
    verify(
      trial.finalSnapshot.sentinelSequence ===
        comparison.sentinelSequence + 1 &&
        trial.finalSnapshot.sentinel === "normal-editor-capture-off",
      "native final sentinel failed",
    );
    if (noLeaf) {
      trial.sentinelEffect = {
        engineChanged: !equal(
          engineState(comparison),
          engineState(trial.finalSnapshot),
        ),
        limitation:
          "The physical Control chord can commit outstanding IBus preedit. The no-leaf buffer/cursor/register criterion uses the state retained before this diagnostic chord.",
      };
    } else
      verify(
        equal(engineState(comparison), engineState(trial.finalSnapshot)),
        "native state changed before final sentinel",
      );
    if (errors.length || inconclusive.length) {
      result.status = errors.length
        ? "discrepancy"
        : "measurement-inconclusive";
      save();
      return;
    }
    if ((index + 1) % 100 === 0) {
      save();
      console.log(`${index + 1}/1000 native ${kind} trials recorded`);
    }
  }
  result.status = "wayland-gate-passed";
}
