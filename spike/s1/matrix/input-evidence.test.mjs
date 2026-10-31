import test from "node:test";
import assert from "node:assert/strict";
import { ModeTrace } from "../wayland/extension/s1-harness@vimcompanion.spike/mode-trace.js";
import {
  freshCompositionEvidence,
  modeTraceEvidence,
  nativeModeEvidence,
} from "./input-evidence.mjs";

const editor = { elementId: 1, editor: true };
const event = (type, time, extra = {}) => ({
  type,
  time,
  target: editor,
  editContext: true,
  ...extra,
});
const composed = (kind = "letter", backend = "wayland") => ({
  case: kind,
  errors: [],
  renderer: {
    before: { time: 0, timeOrigin: 1000 },
    after: {
      time: 100,
      timeOrigin: 1000,
      overflow: 0,
      events: [
        event("compositionstart", 1),
        event("textupdate", 2, {
          text: "ㅎ",
          updateRangeStart: 0,
          updateRangeEnd: 0,
        }),
        ...(backend === "wayland" && kind === "letter"
          ? []
          : [event("compositionend", 3)]),
      ],
    },
  },
});

test("fresh composition requires a new same-target episode and payload, not stale contextText", () => {
  const trial = composed();
  assert.equal(freshCompositionEvidence(trial, "wayland").qualified, true);
  const stale = structuredClone(trial);
  stale.renderer.after.events = [
    event("textupdate", 2, {
      text: "+",
      contextText: "ㅎ+",
      updateRangeStart: 1,
      updateRangeEnd: 1,
    }),
  ];
  assert.equal(freshCompositionEvidence(stale, "wayland").qualified, false);
  for (const mutate of [
    (value) => {
      value.renderer.after.events[1].target = { ...editor, elementId: 2 };
    },
    (value) => {
      value.renderer.after.events[1].editContext = false;
    },
    (value) => {
      value.renderer.after.events[1].text = " ";
      value.renderer.after.events[1].contextText = "ㅎ ";
    },
    (value) => {
      value.renderer.after.events[1].type = "beforeinput";
      value.renderer.after.events[1].data = "ㅎ";
    },
    (value) => {
      value.renderer.after.events[1].updateRangeStart = -1;
    },
    (value) => {
      value.renderer.after.events[1].time = 0;
    },
    (value) => {
      value.renderer.after.timeOrigin++;
    },
    (value) => {
      value.renderer.after.overflow++;
    },
  ]) {
    const changed = structuredClone(trial);
    mutate(changed);
    assert.equal(freshCompositionEvidence(changed, "wayland").qualified, false);
  }
});

test("native no-leaf preedit can remain open; composed cancellation and CDP need an end", () => {
  const open = composed();
  assert.equal(freshCompositionEvidence(open, "wayland").qualified, true);
  open.case = "ctrl-bracket-composed";
  assert.equal(freshCompositionEvidence(open, "wayland").qualified, false);
  open.renderer.after.events.push(event("compositionend", 3));
  assert.equal(freshCompositionEvidence(open, "wayland").qualified, true);
  open.case = "letter-wayland";
  open.renderer.after.events.pop();
  assert.equal(freshCompositionEvidence(open, "x11").qualified, false);
});

test("query composition binds every syllable to its final focused target and preserves known routing failures", () => {
  const target = { elementId: 6, quickInput: true };
  const events = [..."가나다"].flatMap((syllable, index) => [
    { type: "compositionstart", time: index * 3 + 1, target },
    { type: "compositionupdate", time: index * 3 + 2, target, data: syllable },
    { type: "compositionend", time: index * 3 + 3, target },
  ]);
  const trial = composed("quick-open", "x11");
  Object.assign(trial.renderer.after, {
    events,
    inputs: [{ ...target, focused: true, value: "가나다" }],
  });
  assert.equal(freshCompositionEvidence(trial, "x11").qualified, true);
  trial.renderer.after.inputs[0].elementId = 7;
  assert.equal(freshCompositionEvidence(trial, "x11").qualified, false);
  trial.errors.push("composed query reached a different focus target");
  const failed = freshCompositionEvidence(trial, "x11");
  assert.equal(failed.qualified, true);
  assert.equal(failed.destinationMatches, false);
  trial.renderer.after.events = events.filter((item) => item.data !== "나");
  assert.equal(freshCompositionEvidence(trial, "x11").qualified, false);
});

function traceFor(symbols, limit = 256) {
  let time = 0;
  const state = {
    source: "ibus:hangul",
    inputMode: { symbol: symbols[0] },
    focusPid: 100,
    focusClientType: 0,
  };
  const collector = new ModeTrace(
    () => state,
    () => time++,
    limit,
  );
  collector.begin();
  for (const symbol of symbols.slice(1)) {
    state.inputMode.symbol = symbol;
    collector.capture();
  }
  collector.end();
  return { collector, trace: collector.snapshot(), state };
}

test("passive mode trace copies each state, isolates trials and records overflow", () => {
  const { collector, trace, state } = traceFor(["EN", "한", "EN"]);
  assert.equal(
    modeTraceEvidence(trace, ["EN", "한", "EN"], 100).qualified,
    true,
  );
  state.inputMode.symbol = "changed";
  assert.equal(trace.events[0].inputMode.symbol, "EN");
  assert.equal(trace.events[1].inputMode.symbol, "한");
  collector.capture();
  assert.equal(trace.events.length, 4);
  collector.begin();
  collector.end();
  assert.equal(trace.events.length, 4);
  assert.equal(collector.snapshot().events.length, 2);
  assert.equal(
    modeTraceEvidence(
      traceFor(["EN", "한", "EN"], 2).trace,
      ["EN", "한", "EN"],
      100,
    ).qualified,
    false,
  );
});

test("native cancellation cannot qualify from final EN alone and Ctrl+[ preserves Hangul mode", () => {
  const initial = {
    source: "ibus:hangul",
    focusPid: 100,
    focusClientType: 0,
    inputMode: { symbol: "EN" },
  };
  const raw = {
    matrix: { backend: "wayland" },
    nativeSession: { focus: { focusPid: 100 } },
    nativeCompositionProof: { modeTrace: traceFor(["EN", "한", "EN"]).trace },
  };
  const trial = {
    case: "escape-plain",
    initial,
    imeAfter: initial,
    modeTrace: traceFor(["EN"]).trace,
  };
  assert.equal(nativeModeEvidence(raw, trial).qualified, false);
  trial.modeTrace = traceFor(["EN", "한", "EN"]).trace;
  assert.equal(nativeModeEvidence(raw, trial).qualified, true);
  trial.case = "ctrl-bracket-composed";
  trial.imeAfter = { ...initial, inputMode: { symbol: "한" } };
  trial.modeTrace = traceFor(["EN", "한"]).trace;
  assert.equal(nativeModeEvidence(raw, trial).qualified, true);
  for (const mutate of [
    (value) => {
      delete value.modeTrace;
    },
    (value) => {
      value.modeTrace.events[1].focusPid = 200;
    },
    (value) => {
      value.modeTrace.events[1].sequence = 10;
    },
    (value) => {
      value.modeTrace.events[1].source = "xkb:us";
    },
    (value) => {
      value.modeTrace.events[1].timeMs = -1;
    },
    (value) => {
      value.imeAfter.inputMode.symbol = "EN";
    },
  ]) {
    const changed = structuredClone(trial);
    mutate(changed);
    assert.equal(nativeModeEvidence(raw, changed).qualified, false);
  }
  delete raw.nativeCompositionProof.modeTrace;
  assert.equal(nativeModeEvidence(raw, trial).qualified, false);
});
