import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { connectStartup, awaitStartupReady } from "./startup-transport.mjs";
import { engineState } from "../bounded-gates.mjs";
import { clockSamples } from "./observer.mjs";

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export async function runRestart({
  result,
  call: initialCall,
  inject,
  settled: initialSettled,
  noPending,
  save,
  text,
  observer,
  phase,
  base,
  phaseFile,
  check,
}) {
  let call = initialCall,
    settled = initialSettled,
    endpoint;
  result.restartProtocol = {
    readiness:
      "New probe PID and epoch, naturally active Vim and fresh editorTextFocus/vim.active sentinel; capture-on and capture-off both trigger the first j immediately",
    observation:
      "No engine inspector, leader metadata, reset, Escape or capture-off wait before the first key in the new host",
  };
  for (let index = 0; index < 1000; index++) {
    await call("prepare");
    const prepared = await settled();
    inject(["ctrl+alt+9"]);
    const before = await settled();
    assert.equal(before.sentinelSequence, prepared.sentinelSequence + 1);
    assert.equal(before.sentinel, "normal-editor-capture-off");
    assert.equal(before.text, text);
    assert.deepEqual(before.selections, [[0, 0, 0, 0]]);
    assert.ok(noPending(before));
    const entryPhaseDelayMs = await phase();
    inject(["space"]);
    const entry = await settled();
    inject(["ctrl+alt+9"]);
    const entered = await settled();
    assert.equal(entered.sentinelSequence, entry.sentinelSequence + 1);
    assert.equal(entered.sentinel, "normal-editor-capture-on");
    assert.ok(entered.leader.active);
    inject(["w"]);
    const prefix = await settled();
    assert.deepEqual(prefix.leader.prefix, ["w"]);
    const old = await call("passive");
    const oldLoad = await call("loadWindows");
    const rendererBefore = await observer.begin();
    const phaseDelayMs = await phase();
    writeFileSync(
      phaseFile,
      JSON.stringify({
        delayMs: (index * 37 + 17) % 100,
        calibration: false,
        token: "restart-" + index,
      }),
    );
    const requestedAt = performance.now();
    const requested = await call("restart");
    endpoint?.close();
    endpoint = await connectStartup(base, { previousPid: old.pid, check });
    call = (method, params) => endpoint.call(method, params);
    const readiness = await awaitStartupReady({
      endpoint,
      inject,
      check,
      previousEpoch: old.epoch,
    });
    const firstKeyRequestedAt = performance.now();
    inject(["j"]);
    const injectionFinishedAt = performance.now();
    const postInputPassiveSamples = [];
    const markerDeadline = performance.now() + 5000;
    do {
      const value = await call("passive");
      postInputPassiveSamples.push(value);
      if (value.companionActive) break;
      await sleep(25);
    } while (performance.now() < markerDeadline);
    const attach = await call("attach");
    settled = async () => {
      await sleep(100);
      let previous;
      const deadline = performance.now() + 10000;
      do {
        check();
        const value = await call("snapshot");
        const comparable = (snapshot) =>
          snapshot && { ...snapshot, matrixObservation: undefined };
        const stable = equal(comparable(previous), comparable(value));
        previous = value;
        if (
          stable &&
          value.matrixObservation.engineStable &&
          value.queue.pending === 0 &&
          value.queue.jobs === 0 &&
          !value.queue.running
        )
          return value;
        await sleep(25);
      } while (performance.now() < deadline);
      throw new Error("restarted engine did not settle");
    };
    const after = await settled();
    inject(["ctrl+alt+9"]);
    const finalSnapshot = await settled();
    const rendererAfter = await observer.read();
    const hello = await call("hello"),
      loadWindows = await call("loadWindows");
    const clocks = {
      renderer: await clockSamples(() => observer.clock()),
      hosts: await clockSamples(() => call("clock")),
    };
    const errors = [],
      inconclusive = [];
    const verify = (ok, message) => {
      if (!ok) errors.push(message);
    };
    verify(
      hello.pid !== old.pid && readiness.ready.epoch !== old.epoch,
      "extension host did not restart",
    );
    verify(
      readiness.ready.startupSentinel.capture === false,
      "capture remained on at the first Vim-ready sentinel",
    );
    verify(
      after.viewColumn === 2 && equal(after.selections, [[1, 0, 1, 0]]),
      "first post-restart j did not move down once",
    );
    verify(
      after.text === text && after.mode === 0 && noPending(after),
      "restart changed text or left mode/pending input",
    );
    verify(
      !after.leader?.active &&
        !after.leader?.events.some(
          (event) => event.type === "key" && event.value === "j",
        ),
      "new host captured the first j",
    );
    verify(
      finalSnapshot.sentinelSequence === after.sentinelSequence + 1 &&
        finalSnapshot.sentinel === "normal-editor-capture-off",
      "restart capture/focus was not released",
    );
    verify(
      equal(engineState(after), engineState(finalSnapshot)) &&
        equal(after.leader, finalSnapshot.leader),
      "restart state changed before final sentinel",
    );
    verify(rendererAfter.overflow === 0, "restart renderer event overflow");
    const arrivals = rendererAfter.events.filter(
      (event) =>
        event.type === "keydown" && !event.ctrl && !event.alt && !event.meta,
    );
    verify(
      arrivals.length === 1 &&
        arrivals[0].key === "j" &&
        arrivals[0].target?.editor,
      "restart did not deliver exactly one first j to the editor",
    );
    if (hello.leaderPid === null)
      inconclusive.push(
        "companion startup/placement was not observed after the measured key",
      );
    if (hello.leaderPid !== null)
      verify(
        result.matrix.affinity === "separate"
          ? hello.pid !== hello.leaderPid
          : hello.pid === hello.leaderPid,
        "restart host placement differs",
      );
    if (result.condition.load !== "idle")
      verify(
        hello.pid === hello.loadPid && loadWindows.length > 0,
        "restart blocking host was not observed",
      );
    result.trials.push({
      index,
      case: "restart",
      entryPhaseDelayMs,
      phaseDelayMs,
      requestedAt,
      requested,
      old,
      oldLoad,
      before,
      entry: entered,
      prefix,
      readiness,
      postInputPassiveSamples,
      firstKeyRequestedAt,
      injectionFinishedAt,
      attach,
      hello,
      companionPlacementObserved: hello.leaderPid !== null,
      after,
      finalSnapshot,
      loadWindows,
      clocks,
      renderer: { before: rendererBefore, after: rendererAfter },
      errors,
      inconclusive,
    });
    if (errors.length || inconclusive.length) {
      result.status = errors.length
        ? "discrepancy"
        : "measurement-inconclusive";
      save();
      endpoint.close();
      return;
    }
    if ((index + 1) % 100 === 0) {
      save();
      console.log(`${index + 1}/1000 restart trials recorded`);
    }
  }
  result.status = "restart-gate-passed";
  endpoint?.close();
}
