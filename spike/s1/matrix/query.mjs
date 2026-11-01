import assert from "node:assert/strict";
import { engineState } from "../bounded-gates.mjs";

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function queryFocusErrors(renderer) {
  const errors = [];
  const arrivals = renderer.events.filter(
    (event) =>
      event.type === "keydown" && !event.ctrl && !event.alt && !event.meta,
  );
  if (
    !equal(
      arrivals.map((event) => event.key),
      [" ", " ", "a", "b", "c"],
    )
  )
    errors.push("renderer did not observe the exact query sequence");
  if (
    arrivals.length < 2 ||
    !arrivals
      .slice(0, 2)
      .every((event) => event.target?.editor && !event.target?.quickInput)
  )
    errors.push("editor DOM focus was lost before the query leaf");
  if (
    arrivals.length >= 2 &&
    renderer.events.some(
      (event) =>
        event.time >= arrivals[0].time &&
        event.time < arrivals[1].time &&
        ((event.type === "focusout" && event.target?.editor) ||
          (event.type === "focusin" && !event.target?.editor)),
    )
  )
    errors.push("editor DOM focus changed between query leader keys");
  if (renderer.events.some((event) => event.type === "window-blur"))
    errors.push("IDE window lost focus during the query trial");
  return errors;
}

export async function runQuery({
  result,
  call,
  inject,
  settled,
  noPending,
  save,
  text,
  observer,
  phase,
}) {
  for (let index = 0; index < 1000; index++) {
    await call("prepare");
    const prepared = await settled();
    inject(["ctrl+alt+9"]);
    const before = await settled();
    assert.equal(before.sentinelSequence, prepared.sentinelSequence + 1);
    assert.equal(before.sentinel, "normal-editor-capture-off");
    assert.equal(before.text, text);
    assert.equal(before.viewColumn, 2);
    assert.ok(noPending(before));
    assert.ok(!before.leader.active);
    const rendererBefore = await observer.begin();
    const phaseDelayMs = await phase();
    const injectedAt = Date.now();
    inject(["space", "space", "a", "b", "c"]);
    const injectionFinishedAt = Date.now();
    const after = await settled();
    const rendererAfter = await observer.read();
    const errors = queryFocusErrors(rendererAfter);
    const check = (ok, message) => {
      if (!ok) errors.push(message);
    };
    check(rendererAfter.overflow === 0, "renderer event overflow");
    const input = rendererAfter.inputs.filter(
      (item) => item.quickInput && item.focused,
    );
    check(
      input.length === 1 && input[0].value === "abc",
      "query did not reach Quick Open exactly",
    );
    check(
      rendererAfter.documentFocused && rendererAfter.active?.quickInput,
      "Quick Open lacks real focus",
    );
    check(
      equal(engineState(before), engineState(after)),
      "query changed engine state",
    );
    check(
      equal(
        after.leader.events
          .filter((e) => e.type === "key")
          .map((e) => [e.value, e.active]),
        [["space", true]],
      ),
      "query keys reached leader or the entry was lost",
    );
    check(
      after.leader.events.filter(
        (e) =>
          e.type === "leaf-start" && e.command === "workbench.action.quickOpen",
      ).length === 1,
      "Quick Open leaf did not run exactly once",
    );
    const trial = {
      index,
      phaseDelayMs,
      injectedAt,
      injectionFinishedAt,
      before,
      after,
      renderer: { before: rendererBefore, after: rendererAfter },
      errors,
    };
    result.trials.push(trial);
    // Preserve the measured destination before dismissal and verify release
    // separately. Escape is cleanup, not part of the immediate query.
    inject(["Escape"]);
    trial.dismissed = await settled();
    check(
      equal(engineState(after), engineState(trial.dismissed)),
      "query dismissal changed engine state",
    );
    inject(["ctrl+alt+9"]);
    trial.cleanup = await settled();
    check(
      trial.cleanup.sentinel === "normal-editor-capture-off" &&
        !trial.cleanup.leader.active &&
        trial.cleanup.sentinelSequence === trial.dismissed.sentinelSequence + 1,
      "capture did not release after query dismissal",
    );
    check(
      equal(engineState(trial.dismissed), engineState(trial.cleanup)) &&
        equal(trial.dismissed.leader, trial.cleanup.leader),
      "state changed before query cleanup sentinel",
    );
    if (errors.length) {
      result.status = "discrepancy";
      save();
      return;
    }
    if ((index + 1) % 100 === 0) {
      save();
      console.log(`${index + 1}/1000 query trials recorded`);
    }
  }
  result.status = "query-gate-passed";
}
