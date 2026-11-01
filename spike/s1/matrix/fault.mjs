import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { engineState } from "../bounded-gates.mjs";
import { clockSamples } from "./observer.mjs";

export const faultCases = [
  "throw",
  "hang-immediate",
  "hang-watchdog",
  "undefined",
  "document",
  "editor",
  "mouse",
  "blur",
  "reset-root",
  "reset-prefix",
];
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Both pinned Chromium builds coarsen each performance.now() operand to at most
// 100 us. Allow both operands plus microsecond conversion; see README timing.
export const rendererTimeErrorMs = 0.202;
const clockBound = (samples, member, errorMs = 0) => {
  const intervals = samples.map((sample) => {
    const remote = member ? sample.remote[member] : sample.remote;
    return [
      sample.sent - remote.time - errorMs,
      sample.received - remote.time + errorMs,
    ];
  });
  const lower = Math.max(...intervals.map(([lower]) => lower));
  const upper = Math.min(...intervals.map(([, upper]) => upper));
  return lower <= upper ? { lower, upper } : null;
};

export function faultOrder(
  kind,
  { renderer, effects, leader, action, clocks },
) {
  const keys = renderer.events.filter(
    (event) =>
      event.type === "keydown" &&
      event.key === "j" &&
      !event.ctrl &&
      !event.alt,
  );
  if (keys.length !== 1)
    return { outcome: "inconclusive", reason: "first j arrival is not unique" };
  const firstKey = keys[0];
  if (["document", "editor", "reset-root", "reset-prefix"].includes(kind))
    return action.response && action.firstKeyRequestedAt > action.returnedAt
      ? {
          outcome: "proven",
          method: "public action completed before j injection was requested",
        }
      : {
          outcome: "inconclusive",
          reason: "API completion ordering is missing",
        };
  if (kind === "blur") {
    const blur = renderer.events.find((event) => event.type === "window-blur");
    return blur && blur.time < firstKey.time
      ? {
          outcome: "proven",
          method: "renderer blur preceded j in the same clock",
          effect: blur.time,
          firstKey: firstKey.time,
        }
      : {
          outcome: "inconclusive",
          reason: "renderer blur before j is missing",
        };
  }
  const mouse = kind === "mouse";
  const effect = mouse
    ? effects.events.find(
        (event) => event.type === "selection-effect" && event.kind === 2,
      )
    : leader.events.find((event) =>
        kind === "undefined"
          ? event.type === "key" && event.value === "z" && event.active
          : event.type === "fault" &&
            event.kind === (kind === "throw" ? "throw" : "hang"),
      );
  const rendererClock = clockBound(clocks.renderer, null, rendererTimeErrorMs);
  const effectClock = clockBound(clocks.hosts, mouse ? null : "leader");
  if (!effect || !rendererClock || !effectClock)
    return {
      outcome: "inconclusive",
      reason: "effect or intersecting clock bounds missing",
    };
  if (mouse) {
    const pointer = renderer.events.find(
      (event) => event.type === "pointerdown",
    );
    const release = leader.events.find((event) => event.type === "end");
    const leaderClock = clockBound(clocks.hosts, "leader");
    if (
      pointer &&
      release &&
      leaderClock &&
      release.t + leaderClock.upper <
        pointer.time - rendererTimeErrorMs + rendererClock.lower
    )
      return {
        outcome: "inconclusive",
        reason: "capture ended before the injected mouse fault",
      };
  }
  const effectTime = mouse ? effect.time : effect.t;
  const gap = {
    lowerMs:
      firstKey.time -
      rendererTimeErrorMs +
      rendererClock.lower -
      effectTime -
      effectClock.upper,
    upperMs:
      firstKey.time +
      rendererTimeErrorMs +
      rendererClock.upper -
      effectTime -
      effectClock.lower,
  };
  return {
    outcome:
      gap.lowerMs >= 0
        ? "proven"
        : !mouse && gap.upperMs < 0
          ? "early-key"
          : "inconclusive",
    method: mouse
      ? "selection callback is an upper bound on the mouse effect"
      : "leader fault occurrence bounded against renderer j",
    ...gap,
    rendererTimestampErrorBoundMs: rendererTimeErrorMs,
  };
}
export function watchdogOutcome(events) {
  const key = events
    .filter((event) => event.type === "key" && event.active)
    .at(-1);
  const request = events.find(
    (event) => event.type === "release-request" && event.reason === "watchdog",
  );
  const ack = events.find(
    (event) => event.type === "end" && event.reason === "watchdog",
  );
  if (!key || !request || !ack)
    return {
      outcome: "inconclusive",
      reason: "watchdog request or acknowledgement missing",
    };
  const lowerMs = request.t - key.t,
    upperMs = ack.t - key.t;
  return {
    outcome:
      upperMs <= 5000 ? "pass" : lowerMs > 5000 ? "fail" : "inconclusive",
    lowerMs,
    upperMs,
    lastKey: key.t,
    request: request.t,
    acknowledged: ack.t,
  };
}

export async function runFault({
  result,
  call,
  inject,
  settled,
  noPending,
  save,
  text,
  observer,
  phase,
  workspace,
  xdo,
  window,
  createSink,
}) {
  const kind = result.matrix.case;
  assert.ok(faultCases.includes(kind));
  const delay = result.condition.delayMs;
  const target = join(workspace, "fault-target.txt");
  const targetUri = pathToFileURL(target).href;
  let coordinates, sink, reference;
  if (kind === "editor") {
    writeFileSync(target, text);
    await call("openTab", { file: target, column: 1 });
    await call("prepare");
  }
  if (kind === "mouse") {
    await call("prepare");
    await settled();
    coordinates = await observer.evaluate(`(()=>{
      const editor=document.activeElement.closest(".monaco-editor");
      const line=editor?.querySelector(".view-lines .view-line");
      if(!line)throw new Error("active editor line missing");
      const walker=document.createTreeWalker(line,NodeFilter.SHOW_TEXT);
      let node,offset=6;
      while(node=walker.nextNode()){
        if(offset<node.textContent.length){
          const range=document.createRange();range.setStart(node,offset);range.setEnd(node,offset+1);
          const rect=range.getBoundingClientRect();
          if(!rect.width || !rect.height)throw new Error("mouse target is not visible");
          return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2),
            innerWidth,innerHeight,outerWidth,outerHeight,devicePixelRatio};
        }
        offset-=node.textContent.length;
      }
      throw new Error("mouse target character missing");
    })()`);
    const geometry = Object.fromEntries(
      xdo(["getwindowgeometry", "--shell", window])
        .split("\n")
        .map((line) => line.split("="))
        .filter((parts) => parts.length === 2),
    );
    coordinates.nativeGeometry = geometry;
    result.mouseFixture = { coordinates, windowRelative: true };
    save();
    assert.equal(
      coordinates.devicePixelRatio,
      1,
      "mouse fixture needs the proved 1:1 CSS/X scale",
    );
    assert.equal(
      Number(geometry.WIDTH),
      coordinates.innerWidth,
      "mouse viewport width differs from X client",
    );
    assert.equal(
      Number(geometry.HEIGHT),
      coordinates.innerHeight,
      "mouse viewport height differs from X client",
    );
  }
  if (kind === "blur") {
    sink = await createSink();
    xdo(["windowfocus", "--sync", window]);
  }
  const mouseAndJ = () =>
    xdo([
      "mousemove",
      "--window",
      window,
      String(coordinates.x),
      String(coordinates.y),
      "click",
      "1",
      "sleep",
      String(delay / 1000),
      "key",
      "--clearmodifiers",
      "--delay",
      String(delay),
      "j",
    ]);
  async function apiAndJ(action, record) {
    record.requestedAt = performance.now();
    record.response = await call("faultAction", { kind: action });
    record.returnedAt = performance.now();
    await sleep(delay);
    record.firstKeyRequestedAt = performance.now();
    inject(["j"]);
  }
  if (["editor", "mouse"].includes(kind)) {
    const references = [];
    result.effectReference = references;
    for (let i = 0; i < 2; i++) {
      await call("prepare");
      const before = await settled();
      await call("faultSetup", { entryUri: before.documentUri, target });
      const action = {};
      const rendererBefore = await observer.begin();
      if (kind === "editor") await apiAndJ("editor", action);
      else mouseAndJ();
      const after = await settled();
      const effects = await call("faultEvents");
      const rendererAfter = await observer.read();
      references.push({
        before,
        after,
        effects,
        action,
        renderer: { before: rendererBefore, after: rendererAfter },
      });
      save();
      assert.equal(
        after.selections[0][2],
        1,
        "capture-off fault reference lost j",
      );
      assert.equal(after.text, text);
      assert.ok(!after.leader.active && !after.leader.events.length);
      if (kind === "mouse")
        assert.ok(
          effects.events.some(
            (event) => event.type === "selection-effect" && event.kind === 2,
          ),
          "mouse reference has no native Mouse selection callback",
        );
    }
    assert.deepEqual(
      engineState(references[0].after),
      engineState(references[1].after),
      "fault reference is not repeatable",
    );
    reference = references[1].after;
  }
  result.faultProtocol = {
    kind,
    coordinates,
    sink: Boolean(sink),
    apiCompletion:
      "Await the public action/edit promise, then request j after the condition delay; do not observe capture or settled state between completion and j",
    watchdogDeadlineMs: 5000,
  };
  for (let index = 0; index < 1000; index++) {
    await call("prepare");
    await call("text", { value: text });
    const prepared = await settled();
    inject(["ctrl+alt+9"]);
    const before = await settled();
    assert.equal(before.sentinelSequence, prepared.sentinelSequence + 1);
    assert.equal(before.sentinel, "normal-editor-capture-off");
    assert.equal(before.mode, 0);
    assert.ok(noPending(before));
    assert.deepEqual(before.selections, [[0, 0, 0, 0]]);
    await call("faultSetup", { entryUri: before.documentUri, target });
    const rendererBefore = await observer.begin();
    const entryPhaseDelayMs = await phase();
    inject(["space"]);
    const entry = { samples: [] };
    const entryDeadline = Date.now() + 1000;
    do {
      const sample = await settled();
      inject(["ctrl+alt+9"]);
      const confirmed = await settled();
      entry.samples.push({ sample, confirmed });
      if (
        confirmed.leader.active &&
        confirmed.sentinel === "normal-editor-capture-on" &&
        confirmed.sentinelSequence === sample.sentinelSequence + 1
      )
        break;
    } while (Date.now() < entryDeadline);
    assert.equal(
      entry.samples.at(-1).confirmed.sentinel,
      "normal-editor-capture-on",
      "fault entry was not confirmed",
    );
    if (kind === "reset-prefix") {
      inject(["w"]);
      entry.prefix = await settled();
      assert.deepEqual(entry.prefix.leader.prefix, ["w"]);
      assert.ok(entry.prefix.leader.active);
    }
    const action = {};
    const phaseDelayMs = await phase();
    const injectedAt = Date.now();
    if (kind === "throw") inject(["x", "t", "j"]);
    else if (kind === "hang-immediate") inject(["x", "h", "j"]);
    else if (kind === "hang-watchdog") {
      inject(["x", "h"]);
      action.started = await settled();
      assert.ok(
        action.started.leader.events.some(
          (event) => event.type === "fault" && event.kind === "hang",
        ),
      );
      const lastKey = action.started.leader.events
        .filter((event) => event.type === "key" && event.active)
        .at(-1);
      const clock = result.matrix.clocksBefore.hosts;
      const upperOffset = Math.min(
        ...clock.map((sample) => sample.received - sample.remote.leader.time),
      );
      action.keyDeadline = lastKey.t + upperOffset + 5000 + delay;
      await sleep(Math.max(0, action.keyDeadline - performance.now()));
      action.firstKeyRequestedAt = performance.now();
      inject(["j"]);
    } else if (kind === "undefined") inject(["z", "j"]);
    else if (kind === "mouse") mouseAndJ();
    else if (kind === "blur")
      xdo([
        "windowfocus",
        "--sync",
        sink,
        "sleep",
        String(delay / 1000),
        "windowfocus",
        "--sync",
        window,
        "sleep",
        String(delay / 1000),
        "key",
        "--clearmodifiers",
        "--delay",
        String(delay),
        "j",
      ]);
    else await apiAndJ(kind.startsWith("reset") ? "reset" : kind, action);
    const injectionFinishedAt = Date.now();
    const after = await settled();
    inject(["ctrl+alt+9"]);
    const finalSnapshot = await settled();
    const rendererAfter = await observer.read();
    const effects = await call("faultEvents");
    const orderClocks = [
      "document",
      "editor",
      "reset-root",
      "reset-prefix",
      "blur",
    ].includes(kind)
      ? undefined
      : {
          renderer: [
            ...result.matrix.clocksBefore.renderer,
            ...(await clockSamples(() => observer.clock())),
          ],
          hosts: [
            ...result.matrix.clocksBefore.hosts,
            ...(await clockSamples(() => call("clock"))),
          ],
        };
    const order = faultOrder(kind, {
      renderer: rendererAfter,
      effects,
      leader: after.leader,
      action,
      clocks: orderClocks,
    });
    const errors = [],
      inconclusive = [];
    const check = (ok, message) => {
      if (!ok) errors.push(message);
    };
    check(rendererAfter.overflow === 0, "renderer event overflow");
    check(
      !after.leader.active &&
        finalSnapshot.sentinel === "normal-editor-capture-off" &&
        finalSnapshot.sentinelSequence === after.sentinelSequence + 1,
      "fault did not release capture/focus",
    );
    check(
      equal(engineState(after), engineState(finalSnapshot)) &&
        equal(after.leader, finalSnapshot.leader),
      "fault state changed before final sentinel",
    );
    check(
      !after.leader.events.some(
        (event) => event.type === "key" && event.value === "j",
      ),
      "post-fault j reached the leader",
    );
    const expectedKeys =
      kind === "throw"
        ? ["x", "t"]
        : kind.startsWith("hang")
          ? ["x", "h"]
          : kind === "undefined"
            ? ["z"]
            : kind === "reset-prefix"
              ? ["w"]
              : [];
    check(
      equal(
        after.leader.events
          .filter((event) => event.type === "key")
          .map((event) => event.value),
        expectedKeys,
      ),
      "fault leader keys differ from the planned stimulus",
    );
    const reason = {
      throw: "leaf-finally",
      "hang-watchdog": "watchdog",
      undefined: "undefined-key",
      document: "document-change",
      editor: "editor-change",
      mouse: "mouse",
      blur: "window-blur",
      "reset-root": "reset",
      "reset-prefix": "reset",
    }[kind];
    if (reason)
      check(
        after.leader.events.some(
          (event) => event.type === "end" && event.reason === reason,
        ),
        "expected fault cleanup did not complete",
      );
    if (kind.startsWith("hang"))
      check(
        after.leader.events.some(
          (event) => event.type === "fault" && event.kind === "hang",
        ),
        "hang fault did not occur",
      );
    check(
      after.mode === 0 && noPending(after),
      "fault left mode or pending input",
    );
    check(
      after.text === (kind === "document" ? text + "fault-marker" : text),
      "fault caused an unexpected text effect",
    );
    if (reference)
      check(
        equal(engineState(after), engineState(reference)),
        "fault state differs from capture-off effect reference",
      );
    else {
      check(
        equal(after.selections, [[1, 0, 1, 0]]),
        "post-fault j did not move down once",
      );
      check(
        equal(before.registers, after.registers),
        "fault changed registers",
      );
    }
    if (kind === "document")
      check(
        effects.events.some((event) => event.type === "document-effect"),
        "document fault did not occur",
      );
    if (kind === "editor")
      check(
        after.documentUri === targetUri,
        "editor fault target is not active",
      );
    if (kind === "mouse")
      check(
        effects.events.some(
          (event) => event.type === "selection-effect" && event.kind === 2,
        ),
        "mouse fault did not occur",
      );
    if (kind === "blur")
      check(
        rendererAfter.events.some((event) => event.type === "window-blur") &&
          rendererAfter.documentFocused,
        "window blur/recovery was not observed",
      );
    if (kind === "throw")
      check(
        after.leader.events.some(
          (event) => event.type === "leaf-error" && event.id === "fault.throw",
        ),
        "throw fault did not occur",
      );
    let watchdog;
    // A key that preceded the actual fault does not qualify post-fault recovery.
    // Preserve its state observations without turning them into that verdict.
    const unqualifiedObservations =
      order.outcome === "proven" ? [] : errors.splice(0);
    if (order.outcome !== "proven")
      inconclusive.push("fault-before-j ordering is not proven");
    if (kind === "hang-watchdog") {
      watchdog = watchdogOutcome(after.leader.events);
      if (watchdog.outcome === "fail")
        errors.push("watchdog release exceeded 5000 ms");
      else if (watchdog.outcome !== "pass")
        inconclusive.push("watchdog deadline is not proven");
    }
    result.trials.push({
      index,
      case: kind,
      phaseDelayMs,
      entryPhaseDelayMs,
      injectedAt,
      injectionFinishedAt,
      before,
      entry,
      action,
      after,
      finalSnapshot,
      effects,
      faultOrder: order,
      orderClocks,
      unqualifiedObservations,
      watchdog,
      renderer: { before: rendererBefore, after: rendererAfter },
      errors,
      inconclusive,
    });
    if (errors.length || inconclusive.length) {
      result.status = errors.length
        ? "discrepancy"
        : "measurement-inconclusive";
      save();
      return;
    }
    if ((index + 1) % 100 === 0) {
      save();
      console.log(`${index + 1}/1000 ${kind} trials recorded`);
    }
  }
  result.status = "fault-gate-passed";
}
