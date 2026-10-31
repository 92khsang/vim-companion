import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const comparable = (state) => ({
  ...state,
  matrixObservation: undefined,
  sentinel: undefined,
  sentinelSequence: undefined,
});
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export async function runCount({
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
  file,
}) {
  const files = [
    file,
    ...[1, 2, 3].map((i) => join(workspace, `count-${i}.txt`)),
  ];
  for (const path of files.slice(1)) writeFileSync(path, text);
  await call("command", { command: "workbench.action.joinAllGroups" });
  for (const path of files) await call("openTab", { file: path, column: 1 });
  result.countFixture = {
    files: files.map((path) => pathToFileURL(path).href),
    tabs: await call("editors"),
  };
  assert.equal(result.countFixture.tabs.length, 1);
  assert.equal(result.countFixture.tabs[0].tabs.length, 4);
  assert.deepEqual(
    result.countFixture.tabs[0].tabs.map((tab) => tab.uri),
    result.countFixture.files,
  );
  for (let index = 0; index < 1000; index++) {
    for (const path of [files[1], files[0]]) {
      await call("openTab", { file: path, column: 1 });
      await call("position");
    }
    await call("clearLeader");
    const prepared = await settled();
    inject(["ctrl+alt+9"]);
    const before = await settled();
    assert.equal(before.sentinelSequence, prepared.sentinelSequence + 1);
    assert.equal(before.sentinel, "normal-editor-capture-off");
    assert.equal(before.documentUri, result.countFixture.files[0]);
    assert.equal(before.text, text);
    assert.equal(before.mode, 0);
    assert.ok(noPending(before));
    assert.deepEqual(before.selections, [[0, 0, 0, 0]]);
    const rendererBefore = await observer.begin();
    const phaseDelayMs = await phase();
    const injectedAt = Date.now();
    inject(["3", "space", "b", "n", "j"]);
    const injectionFinishedAt = Date.now();
    const after = await settled();
    inject(["ctrl+alt+9"]);
    const finalSnapshot = await settled();
    const rendererAfter = await observer.read();
    const errors = [];
    const check = (ok, message) => {
      if (!ok) errors.push(message);
    };
    check(
      after.documentUri === result.countFixture.files[1],
      "count did not switch to the next tab once",
    );
    check(
      equal(after.selections, [[1, 0, 1, 0]]),
      "count carried over to j or j was lost",
    );
    check(
      after.text === text && equal(before.registers, after.registers),
      "count changed text/registers",
    );
    check(
      after.mode === 0 && noPending(after),
      "count left mode or pending input",
    );
    check(
      after.leader.events.filter((e) => e.type === "start").length === 1 &&
        after.leader.events.filter((e) => e.type === "leaf-end").length === 1,
      "count repeated or lost the leader leaf",
    );
    check(
      equal(
        after.leader.events.filter((e) => e.type === "key").map((e) => e.value),
        ["b", "n"],
      ),
      "count sequence leaked into or out of leader",
    );
    check(
      !after.leader.active &&
        finalSnapshot.sentinel === "normal-editor-capture-off" &&
        finalSnapshot.sentinelSequence === after.sentinelSequence + 1,
      "count did not release capture/focus",
    );
    check(
      equal(comparable(after), comparable(finalSnapshot)),
      "count state changed before final sentinel",
    );
    check(rendererAfter.overflow === 0, "renderer event overflow");
    result.trials.push({
      index,
      phaseDelayMs,
      injectedAt,
      injectionFinishedAt,
      before,
      after,
      finalSnapshot,
      renderer: { before: rendererBefore, after: rendererAfter },
      errors,
    });
    if (errors.length) {
      result.status = "discrepancy";
      save();
      return;
    }
    if ((index + 1) % 100 === 0) {
      save();
      console.log(`${index + 1}/1000 count trials recorded`);
    }
  }
  result.status = "count-gate-passed";
}
