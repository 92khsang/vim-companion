import test from "node:test";
import assert from "node:assert/strict";
import {
  clockOffset,
  latency,
  insideWait,
  firstFocus,
  commandTiming,
  observationWindow,
  targetPredicate,
  focusTransitions,
} from "./focus-analysis.mjs";
import { rendererTimeErrorMs } from "./fault.mjs";
import { focusKind } from "./focus.mjs";

test("focus clock bounds retain quantization uncertainty and reject epoch changes", () => {
  const samples = [
    { sent: 10, received: 10.02, remote: { time: 0, timeOrigin: 100 } },
    { sent: 20.05, received: 20.07, remote: { time: 10, timeOrigin: 100 } },
  ];
  assert.equal(clockOffset(samples), null);
  const offset = clockOffset(samples, null, rendererTimeErrorMs);
  assert.ok(offset.lower <= offset.upper);
  const mismatch = structuredClone(samples);
  mismatch[1].remote.timeOrigin++;
  assert.equal(clockOffset(mismatch, null, rendererTimeErrorMs), null);
  assert.deepEqual(latency({ lower: 5, upper: 7 }, { lower: 6, upper: 8 }), {
    lowerMs: -3,
    upperMs: 1,
  });
});
test("provider wait evidence requires strict containment of the whole key interval", () => {
  const request = { lower: 0, upper: 2 },
    response = { lower: 200, upper: 203 };
  assert.equal(
    insideWait({ lower: 10, upper: 11 }, request, response),
    "proven inside",
  );
  assert.equal(
    insideWait({ lower: 1, upper: 3 }, request, response),
    "clock bounds overlap",
  );
  assert.equal(
    insideWait({ lower: -5, upper: -1 }, request, response),
    "before request",
  );
  assert.equal(insideWait(null, request, response), "unobserved");
});
test("a focused list inside Quick Open remains a list target", () => {
  assert.equal(
    focusKind({ quickInput: true, role: "listbox", tag: "DIV" }),
    "list or tree",
  );
  assert.equal(focusKind({ quickInput: true, tag: "INPUT" }), "text input");
});

test("first focus compares native and DOM intervals without inventing no-change results", () => {
  const native = {
    observed: true,
    bounds: { lowerMs: 5, upperMs: 8 },
    source: "native",
  };
  const dom = {
    observed: true,
    bounds: { lowerMs: 12, upperMs: 13 },
    source: "DOM",
  };
  assert.equal(firstFocus([dom, native]).source, "native");
  const overlap = firstFocus([
    dom,
    { ...native, bounds: { lowerMs: 11, upperMs: 15 } },
  ]);
  assert.equal(overlap.source, "DOM or native");
  assert.deepEqual(overlap.bounds, { lowerMs: 11, upperMs: 13 });
  const unknown = firstFocus([{ ...native, bounds: null }]);
  assert.equal(unknown.observed, true);
  assert.equal(unknown.bounds, null);
});
test("pending commands and observation tails retain the exact five-second boundary", () => {
  assert.equal(
    commandTiming(
      10,
      { t: 5011, type: "leaf-end" },
      { lowerMs: 20, upperMs: 21 },
    ).status,
    "none within 5 s",
  );
  assert.equal(
    commandTiming(
      10,
      null,
      { lowerMs: 20, upperMs: 21 },
      { lowerMs: 5001, upperMs: 5002 },
    ).jWhilePending,
    "proven before settlement; pending at 5 s",
  );
  assert.equal(
    commandTiming(10, null, null, { lowerMs: 4999, upperMs: 5001 }).status,
    "unobserved at 5 s",
  );
  assert.equal(
    observationWindow({ lowerMs: 4999, upperMs: 5001 }),
    "boundary overlap",
  );
  assert.equal(
    observationWindow({ lowerMs: 5001, upperMs: 5002 }),
    "after 5 s",
  );
});

test("native dialog targets do not turn unobserved workbench context into false", () => {
  const trial = {
    state: { sentinel: { sequence: 3 } },
    targetSentinel: { sentinel: { sequence: 3, predicate: true } },
    modal: { id: "123" },
    renderer: { documentFocused: false },
  };
  assert.deepEqual(targetPredicate(trial), {
    value: "not evaluated — native dialog target",
    capture: "unobserved",
    underlyingWorkbench: "unobserved",
  });
  assert.equal(targetPredicate({ ...trial, modal: null }).value, "unobserved");
  assert.equal(
    targetPredicate({ ...trial, renderer: { documentFocused: true } }).value,
    "unobserved",
  );
  trial.targetSentinel.sentinel = {
    sequence: 4,
    predicate: false,
    capture: false,
  };
  assert.equal(targetPredicate(trial).value, false);
});

test("a pre-command focus departure cannot hide a later return to the baseline target", () => {
  const offset = { lower: 0, upper: 0 },
    start = { lower: 10, upper: 10 };
  const transitions = focusTransitions(
    [
      { type: "focusout", time: 2, target: { elementId: "A" } },
      { type: "focusin", time: 3, target: { elementId: "B" } },
      { type: "focusout", time: 20, target: { elementId: "B" } },
      { type: "focusin", time: 21, target: { elementId: "A" } },
    ],
    [
      { id: "A", requestedAt: 0, observedAt: 1 },
      { id: "B", previousPoll: { requestedAt: 1 }, observedAt: 3 },
      { id: "A", previousPoll: { requestedAt: 14 }, observedAt: 16 },
    ],
    offset,
    offset,
    start,
  );
  const result = firstFocus(transitions);
  assert.deepEqual(result.bounds, { lowerMs: 4, upperMs: 6 });
  assert.equal(result.source, "native poll interval");
  assert.equal(result.window, "within 5 s");
  assert.equal(result.excluded.length, 3);
  assert.equal(firstFocus(transitions.slice(0, 2)).window, "none within 5 s");
  const boundary = firstFocus([
    { observed: true, bounds: { lowerMs: -1, upperMs: 2 }, source: "DOM" },
  ]);
  assert.equal(boundary.window, "boundary overlap");
});
