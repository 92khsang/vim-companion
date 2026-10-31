import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { baselineSha256 } from "../ready/prototype.mjs";
import { extendedLeader, extendedProbe } from "./extended.mjs";
import { remapProbe } from "./remap.mjs";
import {
  focusProbe,
  focusManifest,
  installFocusProviders,
} from "./focus-instrumentation.mjs";
import {
  startupProbe,
  startupManifest,
  startupLeader,
} from "./startup-probe.mjs";
import {
  faultLeader,
  faultProbe,
  faultCatalog,
  releaseTracing,
} from "./fault-instrumentation.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const patch = (source, before, after) => {
  assert.equal(
    source.split(before).length,
    2,
    "matrix hook must be unique: " + before,
  );
  return source.replace(before, after);
};

export function matrixLeader(source) {
  assert.equal(
    hash(source),
    baselineSha256,
    "matrix needs the retained scoped baseline",
  );
  return patch(
    source.toString(),
    "  context.subscriptions.push(",
    `  context.subscriptions.push(
    vscode.commands.registerCommand("s1.matrix.meta", () => ({ pid: process.pid, timeOrigin: performance.timeOrigin, extensions: vscode.extensions.all.map((item) => item.id).sort() })),
    vscode.commands.registerCommand("s1.matrix.snapshot", () => ({ active, prefix: [...prefix], events: [...events] })),
    vscode.commands.registerCommand("s1.matrix.clock", () => ({time: performance.now(), timeOrigin: performance.timeOrigin, wallTime: Date.now()})),
    vscode.commands.registerCommand("s1.matrix.clear", () => { events.length = 0; }),`,
  );
}

export function matrixProbe(source, companionInstalled = true) {
  let updated = patch(
    source.toString(),
    'const vscode = require("vscode");',
    'const vscode = require("vscode");\nconst { observe } = require("./matrix-observe.cjs");',
  );
  updated = patch(
    updated,
    "  const methods = {",
    `  const methods = {
    clock: async () => ({
      time: performance.now(), timeOrigin: performance.timeOrigin, wallTime: Date.now(),
      leader: ${companionInstalled ? 'await vscode.commands.executeCommand("s1.matrix.clock")' : "null"},
    }),`,
  );
  updated = patch(
    updated,
    "function snapshot() {",
    "function readEngineSnapshot() {",
  );
  updated = patch(
    updated,
    "    leader: leader?.snapshot() ?? null,",
    "    leader: null,",
  );
  updated = patch(
    updated,
    "async function position(editor, line = 0) {",
    `async function snapshot() {
  return observe(readEngineSnapshot, () => leader?.snapshot() ?? null);
}

async function position(editor, line = 0) {`,
  );
  updated = patch(
    updated,
    "    leaderAtObservation: leader?.snapshot() ?? null,",
    '    leaderAtObservation: null,\n    leaderObservation: "not sampled in the document callback",',
  );
  updated = patch(
    updated,
    `  leader = await vscode.extensions
    .getExtension("vim-companion-spike.s1-leader")
    ?.activate();`,
    `  const leaderMetadata = ${companionInstalled ? 'await vscode.commands.executeCommand("s1.matrix.meta")' : "null"};
  leader = leaderMetadata && {
    pid: leaderMetadata.pid,
    snapshot: () => vscode.commands.executeCommand("s1.matrix.snapshot"),
    clearEvents: () => vscode.commands.executeCommand("s1.matrix.clear"),
  };`,
  );
  updated = patch(
    updated,
    "      leaderPid: leader?.pid ?? null,",
    "      leaderPid: leader?.pid ?? null,\n      leaderHost: leaderMetadata,\n      sandbox:{portable:process.env.VSCODE_PORTABLE,globalStorage:context.globalStorageUri.fsPath},",
  );
  return patch(
    updated,
    "      leader?.clearEvents();",
    "      await leader?.clearEvents();",
  );
}

export function installMatrix({ source, extensions, result, options }) {
  const noCompanion = [
    "native-baseline",
    "visual-baseline",
    "vb-entry",
    "vb-pause",
  ].includes(options.row);
  const remap = options.row.startsWith("vb-");
  const startup = ["restart", "cold"].includes(options.row);
  const originalCommit = "eaa78ae4b5e7c28b3b3ecbd699b716e9d5cc333a";
  const manifest = JSON.parse(
    execFileSync("git", [
      "show",
      `${originalCommit}:spike/s1/leader/package.json`,
    ]),
  );
  const inputBindings = JSON.stringify(manifest.contributes.keybindings);
  manifest.contributes.commands = [
    ...(manifest.contributes.commands ?? []),
    ...[
      "meta",
      "snapshot",
      "clear",
      "clock",
      ...(options.row === "fault" ? ["throw", "hang"] : []),
    ].map((name) => ({
      command: "s1.matrix." + name,
      title: "S1 matrix " + name,
    })),
  ];
  const leader = join(extensions, "vim-companion-spike.s1-leader-0.0.0");
  const probe = join(extensions, "vim-companion-spike.s1-probe-0.0.0");
  let leaderSource = matrixLeader(
    readFileSync(join(source, "leader/extension.cjs")),
  );
  let probeSource = matrixProbe(
    readFileSync(join(source, "probe/extension.cjs")),
    !noCompanion,
  );
  if (remap) probeSource = remapProbe(probeSource);
  if (startup) {
    probeSource = startupProbe(probeSource);
    leaderSource = startupLeader(leaderSource);
  }
  const extended = ["query", "count", "fault", "hangul", "focus"].includes(
    options.row,
  );
  let focusArtifacts;
  if (["visual", "visual-baseline"].includes(options.row))
    probeSource = extendedProbe(probeSource);
  if (extended) {
    leaderSource = extendedLeader(leaderSource);
    probeSource = extendedProbe(probeSource);
    let catalog = JSON.parse(
      readFileSync(join(source, "matrix/catalog.json"), "utf8"),
    );
    if (options.row === "fault") {
      leaderSource = faultLeader(leaderSource);
      probeSource = faultProbe(probeSource);
      catalog = faultCatalog(catalog);
      writeFileSync(
        join(probe, "matrix-fault-probe.cjs"),
        readFileSync(join(source, "matrix/fault-probe.cjs")),
      );
    }
    if (options.row === "hangul") leaderSource = releaseTracing(leaderSource);
    if (options.row === "focus") {
      leaderSource = releaseTracing(leaderSource);
      probeSource = focusProbe(probeSource);
      writeFileSync(
        join(probe, "matrix-focus-probe.cjs"),
        readFileSync(join(source, "matrix/focus-probe.cjs")),
      );
      focusArtifacts = installFocusProviders(source, extensions);
    }
    writeFileSync(
      join(leader, "matrix-catalog.json"),
      JSON.stringify(catalog, null, 2),
    );
  }
  if (!noCompanion) {
    writeFileSync(join(leader, "extension.cjs"), leaderSource);
    writeFileSync(
      join(leader, "package.json"),
      JSON.stringify(manifest, null, 2),
    );
  }
  writeFileSync(join(probe, "extension.cjs"), probeSource);
  writeFileSync(
    join(probe, "matrix-observe.cjs"),
    readFileSync(join(source, "matrix/observe.cjs")),
  );
  let probeManifest = JSON.parse(readFileSync(join(probe, "package.json")));
  probeManifest.extensionDependencies = ["vscodevim.vim"];
  for (const active of [false, true])
    probeManifest.contributes.keybindings.push({
      key: "ctrl+alt+9",
      command: "s1.sentinel",
      args: "visual-editor-capture-" + (active ? "on" : "off"),
      when:
        "editorTextFocus && vim.active && vim.mode =~ /^Visual/ && " +
        (active ? "" : "!") +
        "vimCompanion.leaderActive",
    });
  for (const key of ["3", "n", "x", "t", "z", "v", "V", "ctrl+v"]) {
    const bindingKey = key === "V" ? "shift+v" : key;
    if (
      !probeManifest.contributes.keybindings.some(
        (binding) =>
          binding.key === bindingKey && binding.when === "s1.delivery",
      )
    )
      probeManifest.contributes.keybindings.push({
        key: bindingKey,
        command: "s1.deliveryKey",
        args: key,
        when: "s1.delivery",
      });
  }
  if (options.row === "hangul") {
    for (const [key, argument] of [
      ["/", "slash"],
      ["shift+=", "plus"],
    ])
      probeManifest.contributes.keybindings.push({
        key,
        command: "s1.deliveryKey",
        args: argument,
        when: "s1.delivery",
      });
  }
  writeFileSync(
    join(probe, "package.json"),
    JSON.stringify(probeManifest, null, 2),
  );
  let installedStartupLoadSha256 = null;
  if (options.row === "focus") {
    probeManifest = focusManifest(
      probeManifest,
      JSON.parse(readFileSync(join(source, "matrix/catalog.json"))),
    );
    writeFileSync(
      join(probe, "package.json"),
      JSON.stringify(probeManifest, null, 2),
    );
  }
  if (startup) {
    probeManifest = startupManifest(probeManifest);
    writeFileSync(
      join(probe, "package.json"),
      JSON.stringify(probeManifest, null, 2),
    );
    writeFileSync(
      join(extensions, ".s1-startup-phase.json"),
      JSON.stringify({ delayMs: 0, calibration: true, token: "calibration" }),
    );
    const load = join(extensions, "vim-companion-spike.s1-load-0.0.0");
    if (existsSync(load)) {
      const loadSource = readFileSync(join(source, "matrix/startup-load.cjs"));
      writeFileSync(join(load, "extension.cjs"), loadSource);
      const loadManifest = JSON.parse(readFileSync(join(load, "package.json")));
      loadManifest.activationEvents = ["*"];
      writeFileSync(
        join(load, "package.json"),
        JSON.stringify(loadManifest, null, 2),
      );
      installedStartupLoadSha256 = hash(loadSource);
    }
  }
  result.matrix = {
    row: "entry-exit",
    ...options,
    companionInstalled: !noCompanion,
    catalogDispatcher: extended,
    ...(focusArtifacts ? { focusArtifacts } : {}),
    baselineManifestFinalized: true,
    ...(startup ? { startupProbe: true, installedStartupLoadSha256 } : {}),
    inputBindings: "original, with entry-document cleanup",
    originalBindingCommit: originalCommit,
    inputBindingsSha256: hash(inputBindings),
    installedLeaderSha256: noCompanion ? null : hash(leaderSource),
    installedProbeSha256: hash(probeSource),
    installedLeaderManifestSha256: noCompanion
      ? null
      : hash(readFileSync(join(leader, "package.json"))),
    installedProbeManifestSha256: hash(
      readFileSync(join(probe, "package.json")),
    ),
    observation:
      "read-only command RPC in both host conditions; no observation between measured keys",
    sources: Object.fromEntries(
      [
        "run.mjs",
        "matrix/run.mjs",
        "matrix/runner.mjs",
        "matrix/install.mjs",
        "matrix/bounded.mjs",
        "matrix/observe.cjs",
        "matrix/observer.mjs",
        "matrix/extended.mjs",
        "matrix/catalog.json",
        "matrix/query.mjs",
        "matrix/count.mjs",
        "matrix/visual.mjs",
        "matrix/lifecycle.mjs",
        "matrix/resource-errors.mjs",
        "matrix/fault.mjs",
        "matrix/fault-instrumentation.mjs",
        "matrix/fault-probe.cjs",
        "matrix/remap.mjs",
        "matrix/remap-trace-slice.mjs",
        "matrix/cdp-input.mjs",
        "matrix/hangul.mjs",
        "matrix/input-evidence.mjs",
        "matrix/startup-probe.mjs",
        "matrix/startup-transport.mjs",
        "matrix/startup-load.cjs",
        "matrix/restart.mjs",
        "matrix/cold.mjs",
        "matrix/focus-instrumentation.mjs",
        "matrix/focus-probe.cjs",
        "matrix/focus-provider.cjs",
        "matrix/focus-server.cjs",
        "matrix/lsp-framing.cjs",
        "matrix/focus-scenarios.mjs",
        "matrix/focus.mjs",
        "matrix/native-focus.cjs",
        "matrix/wayland.mjs",
        "matrix/wayland-session.mjs",
        "matrix/wayland-runner.mjs",
        "wayland/gnome-harness.sh",
        "wayland/inject.py",
        "wayland/cleanup.py",
        "wayland/settings.ini",
        "wayland/extension/s1-harness@vimcompanion.spike/extension.js",
        "wayland/extension/s1-harness@vimcompanion.spike/mode-trace.js",
        "wayland/extension/s1-harness@vimcompanion.spike/metadata.json",
        "leader/extension.cjs",
        "leader/package.json",
        "probe/extension.cjs",
        "probe/package.json",
        "probe/inspect-reader.cjs",
        "probe/register-contents.cjs",
        "load/extension.cjs",
        "load/package.json",
      ].map((file) => [file, hash(readFileSync(join(source, file)))]),
    ),
  };
}
