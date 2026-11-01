import assert from "node:assert/strict";
import { traceSlice } from "./remap-trace-slice.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { engineState } from "../bounded-gates.mjs";

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function remapSettings(catalog) {
  return catalog.leaves.map((leaf) => ({
    before: [
      "<space>",
      ...leaf.keys.map((key) => (key === "space" ? "<space>" : key)),
    ],
    commands: [
      leaf.exec.args === undefined
        ? leaf.exec.command
        : { command: leaf.exec.command, args: leaf.exec.args },
    ],
  }));
}

export async function runRemap({
  result,
  call,
  inject,
  settled,
  noPending,
  save,
  text,
  observer,
  phase,
  xdo,
  traceRead,
}) {
  assert.equal(result.matrix.companionInstalled, false);
  const pause = result.matrix.row === "vb-pause" ? result.matrix.case : null;
  const delay = result.condition.delayMs;
  result.scope =
    "S1 V-b comparison: record all 1000 trials per condition with no pass threshold or first-discrepancy stop";
  result.remapProtocol = {
    pausePosition: pause,
    pauseMs: pause ? 1500 : null,
    timeoutMs: 1000,
    threshold:
      "record all 1000 trials, with no pass threshold or first-discrepancy stop",
    tracing:
      "Unmodified VSCodeVim stock Trace; logging overhead is part of this measured condition. Handling-key messages alone do not prove native action execution.",
    leafEvidence:
      "Effect on the active editor group; an idempotent effect cannot establish an exact command invocation count",
  };
  for (let index = 0; index < 1000; index++) {
    await call("prepare");
    await call("text", { value: text });
    const prepared = await settled();
    inject(["ctrl+alt+9"]);
    const before = await settled();
    assert.equal(before.sentinelSequence, prepared.sentinelSequence + 1);
    assert.equal(before.sentinel, "normal-editor-capture-off");
    assert.equal(before.viewColumn, 2);
    assert.equal(before.mode, 0);
    assert.ok(noPending(before));
    assert.deepEqual(before.selections, [[0, 0, 0, 0]]);
    assert.equal(before.leader, null);
    await call("remapEvents", { reset: true });
    const rendererBefore = await observer.begin();
    const traceBeforeFiles = traceRead();
    const traceBefore = traceBeforeFiles.map(({ file, bytes }) => ({
      file,
      bytes,
    }));
    const phaseDelayMs = await phase();
    const injectedAt = Date.now();
    if (!pause) inject(["space", "w", "h", "j"]);
    else {
      // One XTEST process controls the pause; no RPC or observer runs between keys.
      xdo([
        "key",
        "--clearmodifiers",
        "--delay",
        String(delay),
        "space",
        ...(pause === "prefix" ? ["w"] : []),
        "sleep",
        "1.5",
        "key",
        "--clearmodifiers",
        "--delay",
        String(delay),
        ...(pause === "root" ? ["w"] : []),
        "h",
        "j",
      ]);
    }
    const injectionFinishedAt = Date.now();
    const after = await settled();
    inject(["ctrl+alt+9"]);
    const finalSnapshot = await settled();
    const rendererAfter = await observer.read();
    const events = await call("remapEvents");
    const traceFiles = traceRead();
    const traceAfter = traceFiles.map(({ file, bytes }) => ({ file, bytes }));
    const traceFragments = traceSlice(traceBeforeFiles, traceFiles);
    const errors = [];
    const check = (ok, message) => {
      if (!ok) errors.push(message);
    };
    check(
      equal(engineState(after), engineState(finalSnapshot)),
      "state changed before final sentinel",
    );
    check(
      after.text === text && equal(before.registers, after.registers),
      "text or registers changed",
    );
    check(
      after.mode === 0 && noPending(after),
      "mode or pending input changed",
    );
    check(
      finalSnapshot.sentinelSequence === after.sentinelSequence + 1 &&
        finalSnapshot.sentinel === "normal-editor-capture-off",
      "editor focus was not confirmed",
    );
    check(
      rendererAfter.overflow === 0 && events.overflow === 0,
      "passive event overflow",
    );
    const leafEffect = after.viewColumn === 1;
    if (!pause) {
      check(leafEffect, "left-group leaf effect absent");
      check(
        equal(after.selections, [[1, 0, 1, 0]]),
        "first j did not move down once in the left editor",
      );
    }
    result.trials.push({
      index,
      case: pause ?? "unpaused",
      phaseDelayMs,
      injectedAt,
      injectionFinishedAt,
      before,
      after,
      finalSnapshot,
      renderer: { before: rendererBefore, after: rendererAfter },
      events,
      traceOffsets: { before: traceBefore, after: traceAfter },
      traceFragments,
      leafEffect,
      nativeKeys: {
        classification: "pending trace and passive-state analysis",
        keys: null,
      },
      errors,
    });
    if ((index + 1) % 100 === 0) {
      save();
      console.log(`${index + 1}/1000 V-b trials recorded`);
    }
  }
  await sleep(500);
  result.vimTrace = traceRead();
  assert.ok(
    result.vimTrace.length &&
      result.vimTrace.some((file) => file.text.includes("Handling key:")),
    "stock Vim trace is missing",
  );
  result.status = "remap-recorded";
}

export function remapProbe(source) {
  const before = "  const methods = {";
  assert.equal(source.split(before).length, 2);
  return source.replace(
    before,
    `  let remapEvents = [], remapOverflow = 0;
  const remapRecord = (type, extra) => {
    if(remapEvents.length >= 2048) {remapOverflow++;return;}
    remapEvents.push({type, time:performance.now(), ...extra});
  };
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(event => remapRecord("selection", {kind:event.kind, column:event.textEditor.viewColumn, selections:event.selections.map(s=>[s.anchor.line,s.anchor.character,s.active.line,s.active.character])})),
    vscode.window.onDidChangeActiveTextEditor(editor => remapRecord("editor", {column:editor?.viewColumn})),
    vscode.workspace.onDidChangeTextDocument(event => remapRecord("text", {changes:event.contentChanges.map(change=>({offset:change.rangeOffset,length:change.rangeLength,text:change.text}))})),
  );
  const methods = {
    remapEvents:({reset=false}={})=>{if(reset){remapEvents=[];remapOverflow=0;}return {events:remapEvents,overflow:remapOverflow,timeOrigin:performance.timeOrigin};},`,
  );
}
