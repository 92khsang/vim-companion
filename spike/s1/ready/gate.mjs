import assert from "node:assert/strict";
import { engineState } from "../bounded-gates.mjs";

export async function runReadyGate({
  result,
  call,
  inject,
  settled,
  noPending,
  save,
  text,
  observer,
}) {
  const cases = [
    { id: "root-ctrl+c", chord: "ctrl+c", reason: "ctrl+c" },
    { id: "root-escape", chord: "Escape", reason: "escape" },
  ];
  result.cases = cases;
  result.visual = observer.metadata;
  const timedInject = (keys) => {
    const timing = { keys, started: performance.now(), startedAt: Date.now() };
    inject(keys);
    timing.finished = performance.now();
    return timing;
  };
  let previousSession = 0;
  for (let round = 0; round < 2; round++) {
    for (const variant of cases) {
      const trial = {
        index: result.trials.length,
        round,
        case: variant.id,
        beforeImage: {},
        readyImage: {},
        hiddenImage: {},
        errors: [],
      };
      result.trials.push(trial);
      const label = String(trial.index + 1).padStart(2, "0");
      let phase = "preparation";
      try {
        await call("prepare");
        const prepared = await settled();
        trial.preSentinelInjection = timedInject(["ctrl+alt+9"]);
        const before = (trial.before = await settled());
        assert.equal(before.sentinelSequence, prepared.sentinelSequence + 1);
        assert.equal(before.sentinel, "normal-editor-capture-off");
        assert.equal(before.viewColumn, 2);
        assert.equal(before.mode, 0);
        assert.ok(noPending(before));
        assert.equal(before.leader.active, false);
        assert.equal(before.leader.readiness.requested, false);
        assert.deepEqual(before.selections, [[0, 0, 0, 0]]);
        assert.equal(before.text, text);
        await observer.observe(trial.beforeImage, false, label + "-before");
        phase = "entry-observation";
        trial.entryInjection = timedInject(["space"]);
        await observer.observe(
          trial.readyImage,
          true,
          label + "-ready",
          trial.entryInjection.finished,
        );
        phase = "entry-sentinel";
        trial.entrySentinelInjection = timedInject(["ctrl+alt+9"]);
        const entry = (trial.entry = await settled());
        trial.entryObserved = performance.now();
        assert.equal(entry.sentinelSequence, before.sentinelSequence + 1);
        assert.equal(entry.sentinel, "normal-editor-capture-on");
        assert.deepEqual(engineState(entry), engineState(before));
        assert.equal(entry.leader.active, true);
        assert.deepEqual(entry.leader.prefix, []);
        assert.deepEqual(
          entry.leader.events.map((event) => event.type),
          ["start", "context-on"],
        );
        const ready = entry.leader.readiness;
        assert.equal(ready.requested, true);
        assert.ok(ready.session > previousSession);
        previousSession = trial.session = ready.session;
        assert.deepEqual(
          ready.events.map((event) => event.type),
          ["session-start", "context-acknowledged", "ready-requested"],
        );
        assert.ok(
          ready.events.every((event) => event.session === trial.session),
        );
        assert.equal(ready.events[1].accepted, true);
        phase = "cancellation";
        trial.suffixInjection = timedInject([variant.chord, "j"]);
        trial.guidedPauseMs =
          trial.suffixInjection.started - trial.entryInjection.finished;
        // Start framebuffer observation before the quiet-state wait.
        phase = "hide-observation";
        try {
          await observer.observe(
            trial.hiddenImage,
            false,
            label + "-hidden",
            trial.suffixInjection.finished,
          );
        } catch (error) {
          trial.errors.push("hide-observation: " + String(error));
          trial.firstFailedPhase = phase;
        }
        const after = (trial.after = await settled());
        trial.finalSentinelInjection = timedInject(["ctrl+alt+9"]);
        const final = (trial.final = await settled());
        phase = "cancellation-assertions";
        const check = (fn) => {
          try {
            fn();
          } catch (error) {
            trial.errors.push(String(error));
          }
        };
        check(() => assert.deepEqual(engineState(after), engineState(final)));
        check(() => assert.deepEqual(after.leader, final.leader));
        check(() => assert.equal(after.leader.active, false));
        check(() => assert.equal(final.sentinel, "normal-editor-capture-off"));
        check(() =>
          assert.equal(final.sentinelSequence, after.sentinelSequence + 1),
        );
        check(() => assert.equal(after.viewColumn, 2));
        check(() => assert.equal(after.mode, 0));
        check(() => assert.ok(noPending(after)));
        check(() =>
          assert.deepEqual(
            after.leader.events.map((event) => event.type),
            ["start", "context-on", "key", "end"],
          ),
        );
        check(() =>
          assert.deepEqual(
            after.leader.events
              .filter((event) => event.type === "key")
              .map((event) => [event.value, event.active]),
            [[variant.reason, true]],
          ),
        );
        check(() =>
          assert.deepEqual(
            after.leader.events
              .filter((event) => event.type === "end")
              .map((event) => event.reason),
            [variant.reason],
          ),
        );
        check(() => assert.equal(after.text, before.text));
        check(() => assert.deepEqual(after.registers, before.registers));
        check(() => assert.deepEqual(after.selections, [[1, 0, 1, 0]]));
        check(() => assert.equal(after.leader.readiness.requested, false));
        check(() => assert.equal(after.leader.readiness.session, null));
        check(() =>
          assert.deepEqual(
            after.leader.readiness.events.map((event) => event.type),
            [
              "session-start",
              "context-acknowledged",
              "ready-requested",
              "hide-requested",
            ],
          ),
        );
        check(() =>
          assert.equal(
            after.leader.readiness.events.at(-1).session,
            trial.session,
          ),
        );
        check(() =>
          assert.equal(
            after.leader.readiness.events.at(-1).reason,
            variant.reason,
          ),
        );
      } catch (error) {
        trial.errors.push(phase + ": " + String(error));
        trial.firstFailedPhase ??= phase;
        // Observation failure must not cause a suffix or recovery key to be sent.
        try {
          trial.stopped = await call("snapshot");
        } catch (snapshotError) {
          trial.snapshotError = String(snapshotError);
        }
      }
      if (trial.errors.length) {
        result.status = "ready-indication-discrepancy";
        trial.firstFailedPhase ??= phase;
        trial.stoppedPhase = phase;
        save();
        console.log(
          "Stopped ready trial " +
            (trial.index + 1) +
            ": " +
            trial.errors.join("; "),
        );
        return;
      }
      save();
    }
  }
  result.status = "ready-indication-awaiting-image-review";
}
