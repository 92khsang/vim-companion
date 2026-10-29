import { spawn, execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  openSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import assert from "node:assert/strict";
import { runBoundedGate } from "./bounded-gates.mjs";

const source = import.meta.dirname;
const code = process.env.S1_CODE ?? "/usr/share/code/code";
const vim = process.env.S1_VIM;
if (!vim)
  throw new Error("Set S1_VIM to the unmodified VSCodeVim 1.32.4 directory");
const output = resolve(process.argv[2] ?? "spike/s1/data/first-gate.json");
if (existsSync(output))
  throw new Error(
    "Choose a new result path; existing evidence is never overwritten",
  );
const delayMs = Number(process.env.S1_DELAY_MS ?? "10");
assert.ok([10, 30, 60].includes(delayMs), "S1_DELAY_MS must be 10, 30 or 60");
const root = mkdtempSync(join(tmpdir(), "s1-"));
const socketPath = join(root, "probe.sock");
const loaded = process.env.S1_LOAD === "1";
const gate = process.env.S1_GATE ?? "entry-exit";
assert.ok(["entry-exit", "cancel", "native-baseline", "native"].includes(gate));
assert.ok(gate === "entry-exit" || (!loaded && delayMs === 10));
const baseline = gate === "native-baseline";
const referencePath = process.env.S1_BASELINE;
assert.ok(gate !== "native" || referencePath, "S1_BASELINE is required");
const reference =
  gate === "native" ? JSON.parse(readFileSync(referencePath, "utf8")) : null;
let phaseSeed = 1053;
const result = {
  scope: "Bounded V-a support investigation; not a final S1 acceptance result",
  gate,
  started: new Date().toISOString(),
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  sourceDirty: execFileSync(
    "git",
    ["status", "--porcelain", "--", "spike/s1", ":!spike/s1/data"],
    { encoding: "utf8" },
  ).trim(),
  node: process.version,
  condition: {
    delayMs,
    load: loaded ? "50 ms blocking every 100 ms" : "idle",
    affinity: "same extension host",
    instances: 1,
    display: "X11 under Xvfb",
    layout: "us",
    phaseSeed: loaded ? phaseSeed : null,
  },
  trials: [],
};
const portable = (value) =>
  JSON.stringify(value, null, 2)
    .replaceAll(root, "$S1_SANDBOX")
    .replaceAll(process.env.HOME, "$HOME");
function save() {
  mkdirSync(resolve(output, ".."), { recursive: true });
  writeFileSync(output, portable(result) + "\n");
}
const environment = { ...process.env };
delete environment.WAYLAND_DISPLAY;
delete environment.ELECTRON_RUN_AS_NODE;
const processes = [];
let client;
let requestId = 0;
let pending;
async function call(method, params = {}) {
  if (pending) throw new Error("overlapping probe requests");
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending = undefined;
      reject(new Error(`probe timeout: ${method}`));
    }, 15000);
    pending = {
      id,
      resolve: (value) => {
        clearTimeout(timer);
        pending = undefined;
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        pending = undefined;
        reject(error);
      },
    };
    client.write(JSON.stringify({ id, method, params }) + "\n");
  });
}
async function until(fn, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let last;
  do {
    last = await fn();
    if (last) return last;
    await sleep(25);
  } while (Date.now() < deadline);
  throw new Error(message);
}
const xdo = (args) =>
  execFileSync("xdotool", args, { env: environment, encoding: "utf8" }).trim();
const inject = (keys) =>
  xdo(["key", "--clearmodifiers", "--delay", String(delayMs), ...keys]);
const idle = (s) =>
  s.queue.pending === 0 && s.queue.jobs === 0 && s.queue.running === false;
const noPending = (s) =>
  !s.pending.actionKeys.length &&
  !s.pending.bufferedKeys.length &&
  s.pending.count === 0 &&
  s.pending.operatorCount === 0;
async function settled() {
  // Queue-idle alone cannot exclude an event still in transit from the renderer.
  // Read after a quiet interval and require two equal snapshots with an idle queue.
  await sleep(100);
  let previous;
  return until(async () => {
    const value = await call("snapshot");
    const same = JSON.stringify(previous) === JSON.stringify(value);
    previous = value;
    return same && idle(value) ? value : false;
  }, "engine did not reach an observed quiet state");
}

try {
  const manifest = JSON.parse(readFileSync(join(vim, "package.json"), "utf8"));
  assert.equal(manifest.version, "1.32.4");
  result.vimBundleSha256 = createHash("sha256")
    .update(readFileSync(join(vim, "out/extension.js")))
    .digest("hex");
  result.product = JSON.parse(
    readFileSync(
      join(resolve(code, ".."), "resources/app/product.json"),
      "utf8",
    ),
  );
  result.product = {
    version: result.product.version,
    commit: result.product.commit,
  };
  assert.equal(result.product.version, "1.141.0");
  const data = join(root, "data");
  const extensions = join(root, "extensions");
  const workspace = join(root, "workspace");
  for (const dir of [
    join(data, "User"),
    extensions,
    workspace,
    join(root, "runtime"),
  ])
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  cpSync(vim, join(extensions, "vscodevim.vim-1.32.4"), { recursive: true });
  for (const name of [
    ...(baseline ? [] : ["leader"]),
    "probe",
    ...(loaded ? ["load"] : []),
  ])
    cpSync(
      join(source, name),
      join(extensions, `vim-companion-spike.s1-${name}-0.0.0`),
      { recursive: true },
    );
  if (baseline) {
    const path = join(
      extensions,
      "vim-companion-spike.s1-probe-0.0.0/package.json",
    );
    const probeManifest = JSON.parse(readFileSync(path, "utf8"));
    probeManifest.extensionDependencies = ["vscodevim.vim"];
    writeFileSync(path, JSON.stringify(probeManifest));
  }
  const settings = {
    "workbench.startupEditor": "none",
    "workbench.tips.enabled": false,
    "workbench.editor.enablePreview": false,
    "window.restoreWindows": "none",
    "files.autoSave": "off",
    "files.hotExit": "off",
    "update.mode": "none",
    "extensions.autoCheckUpdates": false,
    "extensions.autoUpdate": false,
    "telemetry.telemetryLevel": "off",
    "chat.disableAIFeatures": true,
    "editor.autoClosingBrackets": "never",
    "editor.autoClosingQuotes": "never",
    "editor.autoClosingComments": "never",
    "editor.autoSurround": "never",
    "editor.autoIndent": "none",
    "editor.formatOnType": false,
    "editor.formatOnPaste": false,
    "editor.quickSuggestions": false,
    "editor.suggestOnTriggerCharacters": false,
    "editor.wordBasedSuggestions": "off",
    "editor.parameterHints.enabled": false,
    "editor.inlineSuggest.enabled": false,
    "editor.snippetSuggestions": "none",
    "editor.tabCompletion": "off",
    "editor.editContext": true,
    "vim.vimrc.enable": false,
    "vim.useSystemClipboard": false,
    "vim.normalModeKeyBindingsNonRecursive": [
      { before: ["<space>"], commands: ["vimCompanion.startLeader"] },
    ],
    "vim.visualModeKeyBindingsNonRecursive": [
      { before: ["<space>"], commands: ["vimCompanion.startLeader"] },
    ],
  };
  if (baseline) {
    delete settings["vim.normalModeKeyBindingsNonRecursive"];
    delete settings["vim.visualModeKeyBindingsNonRecursive"];
  }
  result.settings = settings;
  writeFileSync(join(data, "User/settings.json"), JSON.stringify(settings));
  const text = "alpha beta gamma\ndelta epsilon zeta\neta theta iota\n";
  const file = join(workspace, "sample.txt");
  writeFileSync(file, text);
  const xvfb = spawn(
    "Xvfb",
    ["-displayfd", "1", "-screen", "0", "1440x1000x24", "-nolisten", "tcp"],
    {
      env: environment,
      detached: true,
      stdio: ["ignore", "pipe", openSync(join(root, "xvfb.log"), "w")],
    },
  );
  processes.push(xvfb);
  environment.DISPLAY = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Xvfb display timeout")),
      10000,
    );
    xvfb.stdout.once("data", (chunk) => {
      clearTimeout(timer);
      resolve(`:${String(chunk).trim()}`);
    });
    xvfb.once("error", reject);
  });
  execFileSync("setxkbmap", ["us"], { env: environment });
  const log = openSync(join(root, "code.log"), "w");
  const ide = spawn(
    "dbus-run-session",
    [
      "--",
      code,
      `--user-data-dir=${data}`,
      `--extensions-dir=${extensions}`,
      "--ozone-platform=x11",
      "--no-sandbox",
      "--password-store=basic",
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-telemetry",
      "--new-window",
      workspace,
    ],
    {
      env: {
        ...environment,
        S1_SOCKET: socketPath,
        XDG_RUNTIME_DIR: join(root, "runtime"),
        XDG_CONFIG_HOME: join(root, "config"),
        XDG_DATA_HOME: join(root, "xdg-data"),
        XDG_CACHE_HOME: join(root, "cache"),
      },
      detached: true,
      stdio: ["ignore", log, log],
    },
  );
  processes.push(ide);
  await until(
    async () => {
      try {
        client = await new Promise((resolve, reject) => {
          const connection = net.createConnection(socketPath);
          connection.once("connect", () => resolve(connection));
          connection.once("error", (error) => {
            connection.destroy();
            reject(error);
          });
        });
        return true;
      } catch {
        return false;
      }
    },
    "probe did not activate",
    60000,
  );
  let buffer = "";
  client.setEncoding("utf8");
  client.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const newline = buffer.indexOf("\n");
      const message = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      if (pending?.id !== message.id)
        throw new Error("unexpected probe response");
      message.error
        ? pending.reject(new Error(message.error))
        : pending.resolve(message.result);
    }
  });
  client.on("error", (error) => pending?.reject(error));
  result.hello = await call("hello");
  if (baseline) assert.equal(result.hello.leaderPid, null);
  else assert.equal(result.hello.pid, result.hello.leaderPid);
  if (loaded) assert.equal(result.hello.pid, result.hello.loadPid);
  const window = await until(() => {
    try {
      return xdo(["search", "--onlyvisible", "--name", "Visual Studio Code"])
        .split("\n")
        .at(-1);
    } catch {
      return false;
    }
  }, "IDE window missing");
  xdo(["windowfocus", "--sync", window]);
  await call("open", { file });
  await sleep(500);
  inject(["Escape"]);
  await sleep(200);
  result.initial = await call("warm");
  if (process.env.S1_DIAG_ONLY === "1") {
    await call("diagnose");
    await call("prepare");
    await settled();
    inject([process.env.S1_DIAG_KEY ?? "ctrl+alt+9"]);
    result.diagnostic = await settled();
    throw new Error("Diagnostic-only run; inspect sandbox renderer log");
  }
  console.log("Sandbox ready; proving 1000 probe keys.");

  const pattern =
    gate === "entry-exit"
      ? ["space", "w", "h", "j", "a", "b", "c", "d", "e", "f"]
      : [
          "space",
          "w",
          "h",
          "j",
          "f",
          "r",
          "d",
          "Escape",
          "ctrl+bracketleft",
          "ctrl+c",
        ];
  const keys = Array.from(
    { length: 1000 },
    (_, i) => pattern[i % pattern.length],
  );
  await call("delivery", { enabled: true });
  inject(keys);
  await sleep(100);
  const observed = await call("delivery", { enabled: false });
  result.delivery = { expected: keys, observed };
  assert.deepEqual(
    observed.map((value) => value.key),
    keys,
    "delivery loss, extra key or reordering",
  );
  await call("text", { value: "" });
  await settled();
  const scriptText = "abcdefghij".repeat(100);
  inject(["i", ...scriptText, "Escape"]);
  const script = await settled();
  result.vimScript = { expected: scriptText, observed: script };
  assert.equal(script.text, scriptText);
  assert.equal(script.mode, 0);
  assert.ok(noPending(script));
  console.log(`Delivery proved; checking ${gate} at ${delayMs} ms.`);
  await call("text", { value: text });
  await settled();

  if (gate !== "entry-exit") {
    await runBoundedGate({
      gate,
      result,
      reference,
      referencePath,
      call,
      inject,
      settled,
      noPending,
      save,
      text,
    });
  } else
    for (let index = 0; index < 1000; index++) {
      await call("prepare");
      const prepared = await settled();
      inject(["ctrl+alt+9"]);
      const before = await settled();
      result.lastPreparation = { index, prepared, before };
      assert.equal(
        before.sentinelSequence,
        prepared.sentinelSequence + 1,
        "pre-trial sentinel key was not received exactly once",
      );
      assert.equal(before.sentinel, "normal-editor-capture-off");
      assert.equal(before.viewColumn, 2);
      assert.equal(before.mode, 0);
      assert.ok(noPending(before));
      assert.equal(before.leader.active, false);
      assert.deepEqual(before.selections, [[0, 0, 0, 0]]);
      assert.equal(before.text, text);
      let phaseDelayMs = 0;
      if (loaded) {
        phaseSeed = (Math.imul(1664525, phaseSeed) + 1013904223) >>> 0;
        phaseDelayMs = phaseSeed % 100;
        await sleep(phaseDelayMs);
      }
      const injectedAt = Date.now();
      inject(["space", "w", "h", "j"]);
      const injectionFinishedAt = Date.now();
      const after = await settled();
      inject(["ctrl+alt+9"]);
      const sentinel = await settled();
      const errors = [];
      const check = (condition, message) => {
        if (!condition) errors.push(message);
      };
      check(
        after.leader.events.filter((e) => e.type === "leaf-end").length === 1,
        "leaf did not complete exactly once",
      );
      check(
        JSON.stringify(
          after.leader.events
            .filter((e) => e.type === "key")
            .map((e) => e.value),
        ) === JSON.stringify(["w", "h"]),
        "leader did not receive exactly w,h",
      );
      check(after.viewColumn === 1, "left group not active");
      check(
        JSON.stringify(after.selections) === JSON.stringify([[1, 0, 1, 0]]),
        "j did not move down once in left editor",
      );
      check(after.text === before.text, "buffer changed");
      check(
        after.mode === 0 && noPending(after),
        "mode or pending input changed",
      );
      check(
        JSON.stringify(after.registers) === JSON.stringify(before.registers),
        "registers changed",
      );
      check(
        !after.leader.active &&
          sentinel.sentinel === "normal-editor-capture-off" &&
          sentinel.sentinelSequence === after.sentinelSequence + 1,
        "capture/focus was not released",
      );
      result.trials.push({
        index,
        phaseDelayMs,
        injectedAt,
        injectionFinishedAt,
        before,
        after,
        finalSentinel: sentinel.sentinel,
        finalSentinelSequence: sentinel.sentinelSequence,
        errors,
      });
      if (errors.length) {
        result.status = "discrepancy";
        console.log(`Stopped at trial ${index + 1}: ${errors.join("; ")}`);
        if (after.leader.active) {
          // Observe the existing watchdog without sending recovery keys or changing the failed trial.
          const recovery = { startedAt: Date.now(), samples: [] };
          result.recoveryObservation = recovery;
          const deadline = Date.now() + 6500;
          let value;
          do {
            await sleep(100);
            value = await call("snapshot");
            recovery.samples.push({
              at: Date.now(),
              active: value.leader.active,
            });
          } while (value.leader.active && Date.now() < deadline);
          recovery.after = value;
          inject(["ctrl+alt+9"]);
          recovery.confirmed = await settled();
          recovery.freshSentinel =
            recovery.confirmed.sentinelSequence === value.sentinelSequence + 1;
          recovery.finishedAt = Date.now();
        }
        break;
      }
      if ((index + 1) % 100 === 0) {
        save();
        console.log(`${index + 1}/1000 entry/exit trials recorded`);
      }
    }
  result.status ??= "first-gate-passed";
  result.loadWindows = await call("loadWindows");
} catch (error) {
  result.status = "harness-error";
  result.error = String(error);
  process.exitCode = 1;
  console.error(String(error));
} finally {
  result.finished = new Date().toISOString();
  save();
  client?.destroy();
  for (const child of processes.reverse()) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
  console.log(`Saved ${output}; sandbox logs retained at ${root}`);
}
