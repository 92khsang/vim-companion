import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  rmSync,
  globSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import net from "node:net";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { connectStartup, awaitStartupReady } from "./startup-transport.mjs";
import { connectMatrixObserver, clockSamples } from "./observer.mjs";
import { ownedIdentities, recordOwned, terminateOwned } from "./lifecycle.mjs";
import { engineState } from "../bounded-gates.mjs";

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function runCold({
  result,
  call,
  inject,
  settled,
  noPending,
  save,
  text,
  xdo,
  check,
  until,
  calibration,
  processes,
  closeCalibrationObserver,
}) {
  const { root, data, extensions, workspace, file, environment, code, ide } =
    calibration;
  const phaseFile = join(extensions, ".s1-startup-phase.json");
  await call("prepare");
  await settled();
  await call("saveFixture");
  const fixtureState = await call("passive");
  assert.equal(fixtureState.active.column, 2);
  assert.equal(fixtureState.active.dirty, false);
  assert.equal(fixtureState.active.text, text);
  assert.deepEqual(fixtureState.active.selections, [[0, 0, 0, 0]]);
  assert.deepEqual(
    fixtureState.editors.map((editor) => editor.column).sort(),
    [1, 2],
  );
  await call("closeWindow");
  await until(
    () => ide.exitCode !== null || ide.signalCode !== null,
    "calibration IDE did not close cleanly",
    30000,
  );
  assert.equal(
    ide.exitCode,
    0,
    "profile fixture needs a clean calibration shutdown",
  );
  closeCalibrationObserver();
  const fixture = join(root, "startup-profile-fixture");
  cpSync(data, fixture, {
    recursive: true,
    filter: (path) =>
      !/(?:^|\/)(?:logs|SingletonLock|SingletonSocket|SingletonCookie)$/.test(
        path,
      ),
  });
  result.coldProtocol = {
    fixtureState,
    fixtureFiles: Object.fromEntries(
      globSync("User/**/*", { cwd: fixture })
        .filter((path) => statSync(join(fixture, path)).isFile())
        .map((path) => [path, hash(readFileSync(join(fixture, path)))]),
    ),
    readiness:
      "First fresh editorTextFocus/vim.active sentinel in each new process; no capture-off wait or inspector before SPC w h j",
    observer:
      "Connect concurrently with startup; never delay the first input for observer readiness. Missing arrival evidence remains explicit.",
    calibration:
      "1000-key delivery and Vim script proved earlier on this same Xvfb display/CPU/install. Two additional fresh-process no-input controls establish initial engine state from the copied profile.",
    phase:
      "Choose the blocking-load timer phase before process launch; no phase delay after readiness",
  };
  result.matrix.ideLaunchers = [result.matrix.ideLauncher];
  result.coldReferences = [];
  let phaseSeed = result.condition.phaseSeed ?? 1053;
  async function one(index, reference) {
    const id =
      (reference ? "reference-" : "trial-") + String(index).padStart(4, "0");
    const trialRoot = join(root, "cold", id),
      profile = join(trialRoot, "user-data"),
      base = join(trialRoot, "probe");
    mkdirSync(trialRoot, { recursive: true, mode: 0o700 });
    for (const name of ["runtime", "config", "xdg-data", "cache"])
      mkdirSync(join(trialRoot, name), { mode: 0o700 });
    cpSync(fixture, profile, { recursive: true });
    writeFileSync(join(trialRoot, "argv.json"), "{}\n");
    if (result.condition.load !== "idle")
      phaseSeed = (Math.imul(1664525, phaseSeed) + 1013904223) >>> 0;
    const loadPhaseMs = result.condition.load === "idle" ? 0 : phaseSeed % 100;
    writeFileSync(
      phaseFile,
      JSON.stringify({ delayMs: loadPhaseMs, calibration: false, token: id }),
    );
    const reservation = net.createServer();
    await new Promise((resolve, reject) => {
      reservation.once("error", reject);
      reservation.listen(0, "127.0.0.1", resolve);
    });
    const debugPort = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const log = openSync(join(trialRoot, "code.log"), "w");
    const env = {
      ...environment,
      S1_SOCKET: base,
      VSCODE_PORTABLE: trialRoot,
      S1_STARTUP_PHASE_FILE: phaseFile,
      XDG_RUNTIME_DIR: join(trialRoot, "runtime"),
      XDG_CONFIG_HOME: join(trialRoot, "config"),
      XDG_DATA_HOME: join(trialRoot, "xdg-data"),
      XDG_CACHE_HOME: join(trialRoot, "cache"),
    };
    delete env.S1_STARTUP_CALIBRATION;
    const launchRequestedAt = performance.now();
    const child = spawn(
      "dbus-run-session",
      [
        "--",
        code,
        `--user-data-dir=${profile}`,
        `--extensions-dir=${extensions}`,
        "--ozone-platform=x11",
        "--no-sandbox",
        "--password-store=basic",
        "--disable-workspace-trust",
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-telemetry",
        "--new-window",
        `--remote-debugging-port=${debugPort}`,
        "--remote-debugging-address=127.0.0.1",
        workspace,
      ],
      { env, detached: true, stdio: ["ignore", log, log] },
    );
    closeSync(log);
    processes.push(child);
    recordOwned(process.env.S1_PROCESS_LEDGER, processes);
    const launcher = { id, pid: child.pid, started: new Date().toISOString() };
    result.matrix.ideLaunchers.push(launcher);
    child.once("exit", (code, signal) => {
      launcher.finished = new Date().toISOString();
      launcher.exit = { code, signal };
    });
    let spawnError;
    child.on("error", (error) => {
      spawnError = error;
    });
    let endpoint, observer, observerError, observerReadyAt, reading;
    const measured = {
      index,
      case: reference ? "cold-reference" : "cold",
      launchRequestedAt,
      loadPhaseMs,
      launcher,
    };
    result.lastColdAttempt = measured;
    const observerPromise = connectMatrixObserver({ port: debugPort, until })
      .then(async (value) => {
        observer = value;
        reading = await observer.begin();
        observerReadyAt = performance.now();
      })
      .catch((error) => {
        observerError = String(error);
      });
    try {
      endpoint = await connectStartup(base, { check });
      const window = await until(() => {
        check();
        if (spawnError) throw spawnError;
        try {
          return xdo([
            "search",
            "--onlyvisible",
            "--name",
            "Visual Studio Code",
          ])
            .split("\n")
            .at(-1);
        } catch {
          return false;
        }
      }, "cold IDE window missing");
      xdo(["windowfocus", "--sync", window]);
      const readiness = await awaitStartupReady({ endpoint, inject, check });
      measured.readiness = readiness;
      // Reject a bad saved fixture immediately; waiting for its restoration here
      // would turn the first-readiness measurement into a warmed trial.
      assert.equal(
        readiness.ready.active?.uri,
        fixtureState.active.uri,
        "cold fixture restored a different document",
      );
      assert.equal(
        readiness.ready.active.column,
        2,
        "cold fixture right group is not ready at the first sentinel",
      );
      assert.deepEqual(
        readiness.ready.editors.map((editor) => editor.column).sort(),
        [1, 2],
        "cold fixture groups are incomplete at first readiness",
      );
      assert.deepEqual(readiness.ready.active.selections, [[0, 0, 0, 0]]);
      assert.equal(readiness.ready.active.text, text);
      measured.firstInputRequestedAt = performance.now();
      if (!reference) inject(["space", "w", "h", "j"]);
      measured.injectionFinishedAt = performance.now();
      measured.launchToInputRequestMs =
        measured.firstInputRequestedAt - launchRequestedAt;
      measured.postInputPassive = [];
      const markerDeadline = performance.now() + 5000;
      do {
        const value = await endpoint.call("passive");
        measured.postInputPassive.push(value);
        if (value.companionActive) break;
        await sleep(25);
      } while (performance.now() < markerDeadline);
      measured.attach = await endpoint.call("attach");
      const quiet = async () => {
        await sleep(100);
        let previous;
        return until(async () => {
          const value = await endpoint.call("snapshot");
          const comparable = (state) =>
            state && { ...state, matrixObservation: undefined };
          const stable = equal(comparable(previous), comparable(value));
          previous = value;
          return stable &&
            value.matrixObservation.engineStable &&
            value.queue.pending === 0 &&
            value.queue.jobs === 0 &&
            !value.queue.running
            ? value
            : false;
        }, "cold engine did not settle");
      };
      measured.after = await quiet();
      inject(["ctrl+alt+9"]);
      measured.finalSnapshot = await quiet();
      measured.hello = await endpoint.call("hello");
      measured.loadWindows = await endpoint.call("loadWindows");
      await observerPromise;
      measured.observer = {
        readyAt: observerReadyAt,
        error: observerError,
        readyBeforeInput: observerReadyAt <= measured.firstInputRequestedAt,
      };
      if (observer) {
        measured.renderer = { before: reading, after: await observer.read() };
        measured.clocks = {
          renderer: await clockSamples(() => observer.clock()),
          hosts: await clockSamples(() => endpoint.call("clock")),
        };
      }
      const after = measured.after,
        final = measured.finalSnapshot,
        errors = [],
        inconclusive = [];
      const verify = (ok, message) => {
        if (!ok) errors.push(message);
      };
      verify(
        readiness.ready.startupSentinel.capture === false,
        "cold readiness had active capture",
      );
      verify(
        after.text === text && after.mode === 0 && noPending(after),
        "cold sequence changed text or left mode/pending input",
      );
      verify(
        equal(engineState(after), engineState(final)) &&
          equal(after.leader, final.leader),
        "cold state changed before final sentinel",
      );
      verify(
        final.sentinelSequence === after.sentinelSequence + 1 &&
          final.sentinel === "normal-editor-capture-off" &&
          !after.leader?.active,
        "cold final capture/focus sentinel failed",
      );
      if (measured.hello.leaderPid === null)
        inconclusive.push(
          "natural companion activation/host placement missing",
        );
      else
        verify(
          result.matrix.affinity === "separate"
            ? measured.hello.pid !== measured.hello.leaderPid
            : measured.hello.pid === measured.hello.leaderPid,
          "cold host placement differs",
        );
      if (result.condition.load !== "idle")
        verify(
          measured.hello.pid === measured.hello.loadPid &&
            measured.loadWindows.length > 0,
          "cold blocking host was not observed",
        );
      if (reference) {
        verify(
          after.viewColumn === 2 && equal(after.selections, [[0, 0, 0, 0]]),
          "cold reference changed fixture state",
        );
        verify(!after.leader?.events.length, "cold reference started a leader");
      } else {
        verify(
          after.viewColumn === 1 && equal(after.selections, [[1, 0, 1, 0]]),
          "first cold sequence lost its leaf or first j",
        );
        verify(
          after.leader?.events.filter((event) => event.type === "leaf-end")
            .length === 1,
          "cold leaf did not complete exactly once",
        );
        verify(
          equal(
            after.leader?.events
              .filter((event) => event.type === "key")
              .map((event) => event.value),
            ["w", "h"],
          ),
          "cold leader keys leaked",
        );
        verify(
          equal(after.registers, result.coldReferences[1].after.registers),
          "cold registers differ from fresh-process controls",
        );
        if (!measured.observer.readyBeforeInput)
          inconclusive.push(
            "renderer arrival observation was not ready before first input",
          );
        else {
          const arrivals = measured.renderer.after.events.filter(
            (event) =>
              event.type === "keydown" &&
              !event.ctrl &&
              !event.alt &&
              !event.meta,
          );
          verify(
            equal(
              arrivals.map((event) => event.key),
              [" ", "w", "h", "j"],
            ),
            "cold renderer sequence differs",
          );
          verify(
            arrivals
              .slice(0, 3)
              .every(
                (event) => event.target?.editor && !event.target?.quickInput,
              ),
            "cold editor focus was lost before the leaf",
          );
          verify(
            !measured.renderer.after.events.some(
              (event) => event.type === "window-blur",
            ),
            "cold IDE window lost focus during the trial",
          );
          verify(
            measured.renderer.after.overflow === 0,
            "cold renderer event overflow",
          );
        }
      }
      Object.assign(measured, { errors, inconclusive });
      (reference ? result.coldReferences : result.trials).push(measured);
      if (!reference && (errors.length || inconclusive.length))
        result.status = errors.length
          ? "discrepancy"
          : "measurement-inconclusive";
      save();
      return measured;
    } catch (error) {
      measured.harnessError = String(error);
      result.lastColdAttempt = measured;
      throw error;
    } finally {
      endpoint?.close();
      await observerPromise;
      observer?.close();
      measured.cleanup = await terminateOwned(ownedIdentities([child]));
      save();
      assert.equal(
        measured.cleanup.remaining.length,
        0,
        "cold IDE groups survived cleanup",
      );
      // Only the disposable clone is removed; code.log and measured evidence stay.
      rmSync(profile, { recursive: true, force: true });
    }
  }
  for (let index = 0; index < 2; index++) {
    const reference = await one(index, true);
    save();
    assert.ok(
      !reference.errors.length && !reference.inconclusive.length,
      "cold reference fixture did not qualify",
    );
  }
  assert.deepEqual(
    engineState(result.coldReferences[0].after),
    engineState(result.coldReferences[1].after),
    "fresh cold references differ",
  );
  for (let index = 0; index < 1000; index++) {
    const trial = await one(index, false);
    if (trial.errors.length || trial.inconclusive.length) {
      result.status = trial.errors.length
        ? "discrepancy"
        : "measurement-inconclusive";
      save();
      return;
    }
    if ((index + 1) % 10 === 0) save();
    if ((index + 1) % 100 === 0)
      console.log(`${index + 1}/1000 fresh-process cold trials recorded`);
  }
  result.status = "cold-gate-passed";
}
