import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { engineState } from "../bounded-gates.mjs";
import { cdpInput, proveCdp } from "./cdp-input.mjs";

export const hangulCases = [
  "letter-x11",
  "letter-wayland",
  "quick-open",
  "search",
  "shift-latin",
  "shift-hangul",
  "escape-plain",
  "escape-composed",
  "ctrl-bracket-plain",
  "ctrl-bracket-composed",
];
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function compositionDeadline(events) {
  const start = events.find((event) => event.type === "start");
  const request = events.find((event) => event.type === "release-request");
  const ack = events.find((event) => event.type === "end");
  if (!start || !request || !ack)
    return {
      outcome: "inconclusive",
      reason: "entry or release bounds missing",
    };
  const lowerMs = request.t - start.t,
    upperMs = ack.t - start.t;
  return {
    outcome:
      upperMs <= 5000 ? "pass" : lowerMs > 5000 ? "fail" : "inconclusive",
    lowerMs,
    upperMs,
    reason: ack.reason,
    origin: "companion received the SPC entry command",
  };
}

export async function runHangul({
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
  const kind = result.matrix.case;
  assert.ok(hangulCases.includes(kind));
  await proveCdp({ result, observer, call, settled, noPending, text });
  const input = cdpInput(observer, result.condition.delayMs);
  const noLeaf = ["letter-x11", "letter-wayland", "shift-hangul"].includes(
    kind,
  );
  const query = ["quick-open", "search"].includes(kind);
  const cancel = kind.startsWith("escape-") || kind.startsWith("ctrl-bracket-");
  result.hangulProtocol = {
    kind,
    input:
      "CDP keyDown/keyUp plus imeSetComposition/insertText; simulated Dubeolsik, not native IBus",
    query: query ? "가나다" : null,
    shiftSpace: kind.startsWith("shift-")
      ? "consumed by the simulated input method; no event is sent to the application"
      : null,
    watchdogObservation: noLeaf
      ? "fixed 5500 ms after the composition, without a capture-off readiness wait; deadline uses retained request/ack bounds"
      : null,
  };
  for (let index = 0; index < 1000; index++) {
    await call("prepare");
    const prepared = await settled();
    inject(["ctrl+alt+9"]);
    const before = await settled();
    assert.equal(before.sentinelSequence, prepared.sentinelSequence + 1);
    assert.equal(before.sentinel, "normal-editor-capture-off");
    assert.equal(before.mode, 0);
    assert.ok(noPending(before) && !before.leader.active);
    assert.equal(before.text, text);
    assert.deepEqual(before.selections, [[0, 0, 0, 0]]);
    const rendererBefore = await observer.begin();
    const phaseDelayMs = await phase();
    const injectedAt = Date.now();
    await input.key("space");
    if (kind === "letter-x11" || kind === "letter-wayland")
      await input.compose(["ㅎ"], { processKey: kind === "letter-x11" });
    else if (kind === "shift-hangul")
      await input.compose(["ㅈ", "조"], { codes: ["KeyW", "KeyH"] });
    else if (query) {
      await input.key(kind === "quick-open" ? "space" : "slash");
      for (const syllable of "가나다") await input.compose([syllable]);
    } else if (kind === "shift-latin") {
      for (const key of ["w", "h", "j"]) await input.key(key);
    } else {
      await input.key("w");
      if (kind.endsWith("composed")) await input.compose(["ㅎ"]);
      await input.key(
        kind.startsWith("escape-") ? "Escape" : "ctrl+bracketleft",
      );
      await input.key(kind.startsWith("escape-") ? "j" : "plus");
    }
    const injectionFinishedAt = Date.now();
    if (noLeaf) await sleep(5500);
    const after = await settled();
    const rendererAfter = await observer.read();
    const errors = [],
      inconclusive = [];
    const check = (ok, message) => {
      if (!ok) errors.push(message);
    };
    check(rendererAfter.overflow === 0, "renderer event overflow");
    const composed = noLeaf || query || kind.endsWith("composed");
    if (composed) {
      const expectedComposition =
        kind === "shift-hangul" ? "조" : query ? "다" : "ㅎ";
      const delivered = rendererAfter.events.filter(
        (event) =>
          [
            "compositionupdate",
            "compositionend",
            "input",
            "textupdate",
          ].includes(event.type) &&
          (event.data?.includes(expectedComposition) ||
            event.text?.includes(expectedComposition) ||
            event.contextText?.includes(expectedComposition)),
      );
      if (!delivered.length)
        inconclusive.push(
          "per-trial composition/commit target evidence is missing",
        );
      const processKeys = rendererAfter.events.filter(
        (event) => event.type === "keydown" && event.keyCode === 229,
      );
      if (kind === "letter-x11")
        check(
          processKeys.length === 1,
          "X11 simulation did not deliver exactly one 229 keydown",
        );
      else
        check(
          processKeys.length === 0,
          "no-key composition simulation delivered a 229 keydown",
        );
    }
    check(
      after.text === text && equal(before.registers, after.registers),
      "composition changed editor text/registers",
    );
    check(
      after.mode === 0 && noPending(after),
      "composition changed mode or pending state",
    );
    const starts = after.leader.events.filter(
      (event) => event.type === "leaf-start",
    );
    const keys = after.leader.events
      .filter((event) => event.type === "key")
      .map((event) => event.value);
    let deadline;
    if (noLeaf) {
      check(starts.length === 0, "composition ran a leaf");
      check(equal(keys, []), "composition arrived as an ordinary leader key");
      check(
        equal(engineState(before), engineState(after)),
        "composition changed engine state",
      );
      check(!after.leader.active, "composition left capture active");
      deadline = compositionDeadline(after.leader.events);
      if (deadline.outcome === "fail")
        errors.push("composition release exceeded 5000 ms");
      if (deadline.outcome === "inconclusive")
        inconclusive.push("composition deadline not proven");
    } else if (query) {
      check(
        starts.length === 1 &&
          starts[0].command ===
            (kind === "quick-open"
              ? "workbench.action.quickOpen"
              : "workbench.action.findInFiles"),
        "query leaf differs from Latin mode",
      );
      check(
        equal(keys, [kind === "quick-open" ? "space" : "/"]),
        "query leader sequence leaked",
      );
      const focused = rendererAfter.inputs.filter((item) => item.focused);
      check(
        focused.length === 1 && focused[0].value === "가나다",
        "composed query did not reach the focused input exactly",
      );
      check(
        rendererAfter.documentFocused &&
          (kind === "quick-open"
            ? focused[0]?.quickInput
            : focused[0]?.searchQuery),
        "composed query reached a different focus target",
      );
      check(
        equal(engineState(before), engineState(after)),
        "composed query changed engine state",
      );
    } else if (cancel) {
      const expected = kind.startsWith("escape-") ? "escape" : "ctrl+[";
      check(
        starts.length === 0 && equal(keys, ["w", expected]),
        "Hangul cancel did not use the expected leader rule",
      );
      check(
        after.leader.events.some(
          (event) => event.type === "end" && event.reason === expected,
        ),
        "Hangul cancel did not end capture",
      );
      check(
        after.viewColumn === 2 && equal(after.selections, [[1, 0, 1, 0]]),
        "first post-cancel key did not move down once",
      );
      check(!after.leader.active, "Hangul cancel left capture active");
    } else {
      check(
        starts.length === 1 &&
          starts[0].command === "workbench.action.focusLeftGroup",
        "Latin switch leaf did not run once",
      );
      check(equal(keys, ["w", "h"]), "Latin switch leader sequence leaked");
      check(
        after.viewColumn === 1 && equal(after.selections, [[1, 0, 1, 0]]),
        "Latin switch lost the leaf or first j",
      );
      check(!after.leader.active, "Latin switch left capture active");
    }
    const trial = {
      index,
      case: kind,
      phaseDelayMs,
      injectedAt,
      injectionFinishedAt,
      before,
      after,
      renderer: { before: rendererBefore, after: rendererAfter },
      deadline,
      errors,
      inconclusive,
    };
    result.trials.push(trial);
    if (query) {
      // Cleanup follows the retained destination observation and cannot qualify it.
      inject(["Escape"]);
      if (kind === "search")
        await call("command", {
          command: "workbench.action.focusActiveEditorGroup",
        });
      trial.dismissed = await settled();
      check(
        equal(engineState(after), engineState(trial.dismissed)),
        "query cleanup changed engine state",
      );
    }
    inject(["ctrl+alt+9"]);
    const finalSnapshot = await settled();
    trial[query ? "cleanup" : "finalSnapshot"] = finalSnapshot;
    const comparison = trial.dismissed ?? after;
    check(
      finalSnapshot.sentinelSequence === comparison.sentinelSequence + 1 &&
        finalSnapshot.sentinel === "normal-editor-capture-off" &&
        !finalSnapshot.leader.active,
      "Hangul final capture/focus sentinel failed",
    );
    check(
      equal(engineState(comparison), engineState(finalSnapshot)),
      "Hangul state changed before final sentinel",
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
      console.log(`${index + 1}/1000 Hangul ${kind} trials recorded`);
    }
  }
  result.status = "hangul-gate-passed";
}
