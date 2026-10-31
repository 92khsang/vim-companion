import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { baselineSha256 } from "../ready/prototype.mjs";

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
    vscode.commands.registerCommand("s1.matrix.clear", () => { events.length = 0; }),`,
  );
}

export function matrixProbe(source) {
  let updated = patch(
    source.toString(),
    'const vscode = require("vscode");',
    'const vscode = require("vscode");\nconst { observe } = require("./matrix-observe.cjs");',
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
  return observe(readEngineSnapshot, () => leader.snapshot());
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
    `  const leaderMetadata = await vscode.commands.executeCommand("s1.matrix.meta");
  leader = {
    pid: leaderMetadata.pid,
    snapshot: () => vscode.commands.executeCommand("s1.matrix.snapshot"),
    clearEvents: () => vscode.commands.executeCommand("s1.matrix.clear"),
  };`,
  );
  updated = patch(
    updated,
    "      leaderPid: leader?.pid ?? null,",
    "      leaderPid: leader?.pid ?? null,\n      leaderHost: leaderMetadata,",
  );
  return patch(
    updated,
    "      leader?.clearEvents();",
    "      await leader?.clearEvents();",
  );
}

export function installMatrix({ source, extensions, result, options }) {
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
    ...["meta", "snapshot", "clear"].map((name) => ({
      command: "s1.matrix." + name,
      title: "S1 matrix " + name,
    })),
  ];
  const leader = join(extensions, "vim-companion-spike.s1-leader-0.0.0");
  const probe = join(extensions, "vim-companion-spike.s1-probe-0.0.0");
  const leaderSource = matrixLeader(
    readFileSync(join(source, "leader/extension.cjs")),
  );
  const probeSource = matrixProbe(
    readFileSync(join(source, "probe/extension.cjs")),
  );
  writeFileSync(join(leader, "extension.cjs"), leaderSource);
  writeFileSync(
    join(leader, "package.json"),
    JSON.stringify(manifest, null, 2),
  );
  writeFileSync(join(probe, "extension.cjs"), probeSource);
  writeFileSync(
    join(probe, "matrix-observe.cjs"),
    readFileSync(join(source, "matrix/observe.cjs")),
  );
  const probeManifest = JSON.parse(readFileSync(join(probe, "package.json")));
  probeManifest.extensionDependencies = ["vscodevim.vim"];
  writeFileSync(
    join(probe, "package.json"),
    JSON.stringify(probeManifest, null, 2),
  );
  result.matrix = {
    row: "entry-exit",
    ...options,
    inputBindings: "original, with entry-document cleanup",
    originalBindingCommit: originalCommit,
    inputBindingsSha256: hash(inputBindings),
    installedLeaderSha256: hash(leaderSource),
    installedProbeSha256: hash(probeSource),
    installedLeaderManifestSha256: hash(
      readFileSync(join(leader, "package.json")),
    ),
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
        "matrix/observe.cjs",
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
