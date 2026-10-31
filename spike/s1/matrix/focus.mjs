import assert from "node:assert/strict";
import { fork, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { focusScenarios } from "./focus-scenarios.mjs";
import { clockSamples } from "./observer.mjs";

const catalog = JSON.parse(
  readFileSync(new URL("./catalog.json", import.meta.url)),
);
const fixtureText = "alpha beta gamma\ndelta epsilon zeta\neta theta iota\n";
const chord = (key) => (key === "/" ? "slash" : key);
export function focusKind(target) {
  if (!target) return "other";
  if (target.dialog) return "dialog";
  if (["tree", "list", "listbox", "option", "treeitem"].includes(target.role))
    return "list or tree";
  if (
    target.rename ||
    (target.quickInput && ["INPUT", "TEXTAREA"].includes(target.tag)) ||
    target.searchQuery ||
    target.scmInput ||
    (["INPUT", "TEXTAREA"].includes(target.tag) && !target.editor)
  )
    return "text input";
  if (
    target.actionList ||
    target.explorer ||
    target.openEditors ||
    target.scm ||
    ["tree", "list", "listbox"].includes(target.role)
  )
    return "list or tree";
  if (target.hover) return "other";
  return target.editor ? "editor text" : "other";
}
export function ownedModal(native, window) {
  const last = native.samples.filter((sample) => sample.id).at(-1);
  const owner = last?.properties?.match(
    /WM_TRANSIENT_FOR[^\n]*window id # (0x[0-9a-f]+)/i,
  );
  return last &&
    last.id !== window &&
    owner &&
    Number.parseInt(owner[1], 16) === Number(window)
    ? last
    : null;
}

async function nativeRecorder(environment) {
  assert.match(environment.DISPLAY ?? "", /^:\d+$/);
  const child = fork(new URL("./native-focus.cjs", import.meta.url), {
    env: environment,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  let final, failure;
  let requestSequence = 0;
  const clockRequests = new Map();
  child.on("error", (error) => {
    failure = error;
  });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("native focus recorder did not start")),
      5000,
    );
    child.once("error", reject);
    child.on("message", (message) => {
      if (message.ready) {
        clearTimeout(timer);
        resolve(message);
      } else if (message.clockResponse) {
        clockRequests.get(message.clockResponse)?.(message);
      } else final = message;
    });
  });
  const readClock = () =>
    new Promise((resolve, reject) => {
      const id = ++requestSequence;
      const timer = setTimeout(() => {
        clockRequests.delete(id);
        reject(new Error("native focus clock request timed out"));
      }, 1000);
      clockRequests.set(id, (message) => {
        clearTimeout(timer);
        clockRequests.delete(id);
        resolve({ time: message.time, timeOrigin: message.timeOrigin });
      });
      child.send({ clockRequest: id });
    });
  const before = await clockSamples(readClock);
  return {
    ready,
    async stop() {
      if (failure) throw failure;
      const after = await clockSamples(readClock);
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.send("stop");
      await exited;
      assert.ok(final, "native focus samples missing");
      final.clocks = { before, after };
      return final;
    },
  };
}

export async function runFocus({
  result,
  call,
  inject,
  settled,
  noPending,
  save,
  observer,
  phase,
  workspace,
  xdo,
  window,
  check,
  until,
  environment,
}) {
  const allScenarios = focusScenarios(catalog).filter(
    (scenario) =>
      (scenario.state === "accessible") ===
      (result.matrix.accessibility === "on"),
  );
  const firstScenario = result.matrix.focusFrom
    ? allScenarios.findIndex(
        (scenario) => scenario.id === result.matrix.focusFrom,
      )
    : 0;
  const lastScenario = result.matrix.focusThrough
    ? allScenarios.findIndex(
        (scenario) => scenario.id === result.matrix.focusThrough,
      )
    : allScenarios.length - 1;
  assert.ok(firstScenario >= 0 && lastScenario >= firstScenario);
  result.scope =
    "S1 #7 focus and provider observations; nine trials per scenario/condition, all outcomes retained";
  result.focusProtocol = {
    scenarios: allScenarios.slice(firstScenario, lastScenario + 1),
    trialsPerScenario: 9,
    entry:
      "Confirm root and any intermediate prefix before the final leaf key. This isolates command/focus behavior and is not an ordinary unpaused entry qualification.",
    delayedKey:
      "Final leaf key and j use one XTEST batch, with no provider/command/focus wait between them.",
    observation:
      "Five seconds from command start, using bounded host clock offsets, followed by a 25 ms recording tail. Analysis excludes changes definitely after five seconds. Passive DOM events, 25 ms UI-state polling and an independent 25 ms X focus poller.",
    predicate:
      "vim.mode =~ /^(Normal|Visual)/ && (editorTextFocus || !inputFocus)",
    configure:
      "Record the initial five-second dialog interval, then select Configure and observe a separate five-second follow-up. Do not relabel the dialog as the first input destination.",
  };
  for (const scenario of result.focusProtocol.scenarios)
    for (let round = 0; round < 9; round++) {
      check();
      // All documents belong to this disposable sandbox. Escape dismisses a
      // pending rename/dialog before fixture saving and replacement.
      inject(["Escape", "Escape"]);
      await sleep(100);
      await observer.begin();
      const trial = {
        index: result.trials.length,
        scenario: scenario.id,
        round,
        errors: [],
        inconclusive: [],
      };
      result.lastFocusAttempt = trial;
      trial.fixture = await call("focusSetup", {
        scenario,
        trial: scenario.id + ":" + round,
        workspace,
        fixtureText,
      });
      if (trial.fixture.needsScmRowFocus) {
        await call("command", { command: "workbench.view.scm" });
        const row = await until(
          async () =>
            observer.evaluate(`(()=>{
        const row=[...document.querySelectorAll('.scm-view .monaco-list-row')].find(node=>node.textContent.includes('scm-change.txt'));
        if(!row)return null;const r=row.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2,scale:devicePixelRatio}:null;
      })()`),
          "SCM resource row missing",
        );
        assert.equal(row.scale, 1);
        xdo([
          "mousemove",
          "--window",
          window,
          String(Math.round(row.x)),
          String(Math.round(row.y)),
          "click",
          "1",
        ]);
        await sleep(100);
        trial.fixture.scmFocused = await observer.read();
        assert.equal(
          focusKind(trial.fixture.scmFocused.active),
          "list or tree",
        );
        await call("command", {
          command: "workbench.action.focusActiveEditorGroup",
        });
      }
      if (scenario.state === "visible") {
        await until(
          async () => (await observer.read()).widgets.hover,
          "pre-existing hover did not appear",
        );
      }
      trial.fixtureDOM = await observer.read();
      if (scenario.state === "accessible" && round === 0) {
        trial.fixtureImage = join(
          workspace,
          "..",
          "focus-accessible-setup.png",
        );
        execFileSync(
          "import",
          [
            "-display",
            environment.DISPLAY,
            "-window",
            "root",
            trial.fixtureImage,
          ],
          { timeout: 5000 },
        );
      }
      await call("clearLeader");
      trial.fixtureReadiness = [];
      trial.windowFocus = {
        before: xdo(["getwindowfocus"]),
        requestedAt: performance.now(),
      };
      xdo(["windowfocus", "--sync", window]);
      trial.windowFocus.after = xdo(["getwindowfocus"]);
      assert.equal(trial.windowFocus.after, window);
      await call("command", {
        command: "workbench.action.focusActiveEditorGroup",
      });
      trial.before = await until(
        async () => {
          const previous = await call("snapshot");
          inject(["ctrl+alt+9"]);
          const observed = await settled();
          trial.fixtureReadiness.push({ previous, observed });
          return (
            observed.sentinelSequence === previous.sentinelSequence + 1 &&
            observed.sentinel === "normal-editor-capture-off" &&
            observed
          );
        },
        "focus fixture never produced a fresh editor/capture-off sentinel",
        5000,
      );
      assert.equal(trial.before.mode, 0);
      assert.ok(noPending(trial.before));
      assert.equal(trial.before.sentinel, "normal-editor-capture-off");
      await until(
        async () => (await observer.read()).documentFocused,
        "sandbox window did not gain real focus",
      );
      if (scenario.state === "visible") {
        // The readiness chord itself can hide hover. Recreate it only after
        // readiness, then preserve what the real leader keys do to it.
        await call("command", { command: "editor.action.showHover" });
        await until(
          async () => (await observer.read()).widgets.hover,
          "visible hover fixture did not return after readiness",
        );
      }
      trial.beforeLeaderDOM = await observer.begin();
      trial.entryPhaseDelayMs = await phase();
      inject(["space"]);
      trial.entry = await settled();
      inject(["ctrl+alt+9"]);
      trial.root = await settled();
      assert.ok(
        trial.root.leader.active &&
          trial.root.sentinel === "normal-editor-capture-on" &&
          trial.root.sentinelSequence === trial.entry.sentinelSequence + 1,
      );
      const prefix = scenario.leaf.keys.slice(0, -1);
      if (prefix.length) {
        inject(prefix.map(chord));
        trial.prefix = await settled();
        assert.deepEqual(trial.prefix.leader.prefix, prefix);
        assert.ok(trial.prefix.leader.active);
      }
      trial.preLeafDOM = await observer.read();
      if (trial.fixture.needsScmRowFocus) {
        trial.scmTreeFocus = await observer.evaluate(`(()=>{
          const row=[...document.querySelectorAll('.scm-view .monaco-list-row')].find(node=>node.textContent.includes('scm-change.txt'));
          if(!row)return null;
          const list=row.closest('.monaco-list');
          return {text:row.textContent,id:row.id,className:row.className,
            focused:row.classList.contains('focused'),
            activeDescendant:list?.getAttribute('aria-activedescendant')};
        })()`);
        assert.ok(
          trial.scmTreeFocus &&
            (trial.scmTreeFocus.focused ||
              (trial.scmTreeFocus.id &&
                trial.scmTreeFocus.activeDescendant === trial.scmTreeFocus.id)),
          "SCM resource tree did not retain its internal focused row before the leaf",
        );
      }
      trial.clocksBefore = {
        renderer: await clockSamples(() => observer.clock()),
        hosts: await clockSamples(() => call("clock")),
      };
      trial.rendererBefore = await observer.begin();
      await observer.beginFocus();
      const native = await nativeRecorder(environment);
      let recorderStopped = false;
      try {
        trial.phaseDelayMs = await phase();
        trial.injectedAt = performance.now();
        inject([
          chord(scenario.leaf.keys.at(-1)),
          ...(scenario.delayed ? ["j"] : []),
        ]);
        trial.injectionFinishedAt = performance.now();
        const initial = await until(
          async () => {
            const state = await call("snapshot");
            return (
              state.leader.events.some(
                (event) => event.type === "leaf-start",
              ) && state
            );
          },
          "confirmed prefix did not dispatch the leaf",
          2000,
        );
        trial.commandStart = initial.leader.events.find(
          (event) => event.type === "leaf-start",
        );
        assert.equal(trial.commandStart.id, scenario.leaf.id);
        const upperOffset = Math.min(
          ...trial.clocksBefore.hosts.map(
            (sample) => sample.received - sample.remote.leader.time,
          ),
        );
        trial.observationDeadline = trial.commandStart.t + upperOffset + 5000;
        trial.observationTailMs = 25;
        const recordingDeadline =
          trial.observationDeadline + trial.observationTailMs;
        while (performance.now() < recordingDeadline)
          await sleep(Math.max(1, recordingDeadline - performance.now()));
        trial.after = await call("snapshot");
        trial.renderer = await observer.finishFocus();
        trial.native = await native.stop();
        recorderStopped = true;
        trial.providerEvents = await call("focusProviders");
        for (const provider of Object.values(trial.providerEvents)) {
          const token = scenario.id + ":" + round;
          provider.logTotals = {
            client: provider.events.length,
            server: provider.server.length,
          };
          provider.events = provider.events.filter(
            (event) => event.trial === token || event.requestTrial === token,
          );
          provider.server = provider.server.filter(
            (event) =>
              event.trial === token || event.configuration?.trial === token,
          );
        }
        trial.state = await call("focusState");
        inject(["ctrl+alt+0"]);
        await sleep(100);
        trial.targetSentinel = await call("focusState");
        trial.modal = ownedModal(trial.native, window);
        trial.target = trial.modal
          ? "dialog"
          : focusKind(trial.renderer.active);
        trial.predicateObserved =
          trial.targetSentinel.sentinel?.sequence ===
          (trial.state.sentinel?.sequence ?? 0) + 1;
        trial.clocksAfter = {
          renderer: await clockSamples(() => observer.clock()),
          hosts: await clockSamples(() => call("clock")),
        };
        if (scenario.state.endsWith("configure")) {
          const button = await observer.evaluate(`(()=>{
          const button=[...document.querySelectorAll('[role="dialog"] button')].find(node=>node.textContent.includes('Configure'));
          if(!button)return null;const r=button.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,scale:devicePixelRatio};
        })()`);
          const nativeConfigure =
            trial.modal &&
            trial.commandStart.command === "editor.action.format" &&
            xdo(["getwindowfocus"]).trim() === trial.modal.id;
          trial.configure = {
            button,
            nativeModal: nativeConfigure ? trial.modal : null,
            requestedAt: performance.now(),
          };
          if (button || nativeConfigure) {
            await observer.begin();
            await observer.beginFocus();
            if (button) {
              assert.equal(button.scale, 1);
              xdo([
                "mousemove",
                "--window",
                window,
                String(Math.round(button.x)),
                String(Math.round(button.y)),
                "click",
                "1",
              ]);
            } else inject(["Return"]);
            await sleep(5000);
            trial.configure.renderer = await observer.finishFocus();
            trial.configure.state = await call("focusState");
            inject(["ctrl+alt+0"]);
            await sleep(100);
            trial.configure.sentinel = await call("focusState");
            if (
              !trial.configure.renderer.active?.quickInput ||
              !trial.configure.renderer.inputs.some(
                (input) =>
                  input.focused && /formatter/i.test(input.label ?? ""),
              )
            )
              trial.inconclusive.push(
                "Configure did not produce the focused formatter picker",
              );
          } else
            trial.inconclusive.push(
              "Configure button was not observed in the formatter dialog",
            );
        }
        if (trial.renderer.overflow)
          trial.errors.push("renderer event overflow");
        result.trials.push(trial);
        save();
        console.log(
          `${scenario.id} ${round + 1}/9 focus observations recorded`,
        );
      } finally {
        if (!recorderStopped) trial.native = await native.stop();
        save();
      }
    }
  result.focusProviderLogs = await call("focusProviders");
  result.status = "focus-recorded";
}
