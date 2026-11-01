import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  cpSync,
  mkdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { faultCases } from "./fault.mjs";
import { hangulCases } from "./hangul.mjs";
import { waylandCases } from "./wayland.mjs";
import { focusScenarios } from "./focus-scenarios.mjs";

const source = resolve(import.meta.dirname, "..");
const output = resolve(process.argv[2] ?? "spike/s1/data/matrix-entry.json");
assert.ok(output.endsWith(".json"), "matrix output must end in .json");
const termination = output.replace(/\.json$/, "-termination.json");
const sources = output.replace(/\.json$/, "") + "-sources";
assert.ok(
  !existsSync(output) && !existsSync(sources) && !existsSync(termination),
  "choose unused result and source paths",
);
assert.ok(!process.env.S1_GATE, "matrix selects its own retained gate");
assert.ok(
  !process.env.S1_DIAG_ONLY &&
    !process.env.S1_TRACE &&
    !process.env.S1_BINDINGS,
  "matrix does not accept diagnostic overrides",
);
const options = {
  row: process.env.S1_MATRIX_ROW ?? "entry-exit",
  version: process.env.S1_MATRIX_VERSION,
  affinity: process.env.S1_AFFINITY ?? "same",
  editContext: process.env.S1_EDIT_CONTEXT !== "false",
  case: process.env.S1_MATRIX_CASE,
  focusFrom: process.env.S1_FOCUS_FROM,
  focusThrough: process.env.S1_FOCUS_THROUGH,
  accessibility: process.env.S1_ACCESSIBILITY ?? "off",
  instances: Number(process.env.S1_INSTANCES ?? 1),
  cpuSet: process.env.S1_CPUS,
  backend: process.env.S1_BACKEND ?? "x11",
};
assert.ok(["off", "on"].includes(options.accessibility));
if (options.accessibility === "on") assert.equal(options.row, "focus");
for (const selection of [options.focusFrom, options.focusThrough].filter(
  Boolean,
)) {
  assert.equal(options.row, "focus");
  assert.ok(
    focusScenarios(
      JSON.parse(readFileSync(join(source, "matrix/catalog.json"))),
    ).some((scenario) => scenario.id === selection),
  );
}
assert.ok(["x11", "wayland"].includes(options.backend));
if (options.backend === "wayland") assert.equal(options.row, "hangul");
assert.ok(Number.isSafeInteger(options.instances) && options.instances >= 1);
if (options.instances > 1)
  assert.ok(options.cpuSet, "parallel instances require separate CPU sets");
if (options.cpuSet)
  assert.match(options.cpuSet, /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/);
if (options.case) {
  assert.ok(
    [
      "cancel",
      "native",
      "native-baseline",
      "visual",
      "fault",
      "vb-pause",
      "hangul",
    ].includes(options.row),
  );
  assert.ok(
    ["native", "native-baseline"].includes(options.row)
      ? ["f-space", "r-space", "d-space"].includes(options.case)
      : options.row === "hangul"
        ? (options.backend === "wayland" ? waylandCases : hangulCases).includes(
            options.case,
          )
        : options.row === "vb-pause"
          ? ["root", "prefix"].includes(options.case)
          : options.row === "fault"
            ? faultCases.includes(options.case)
            : options.row === "visual"
              ? ["character", "line", "block"].includes(options.case)
              : [
                  "root-escape",
                  "root-ctrl+[",
                  "root-ctrl+c",
                  "w-escape",
                  "w-ctrl+[",
                  "w-ctrl+c",
                ].includes(options.case),
  );
}
if (["fault", "vb-pause", "hangul"].includes(options.row))
  assert.ok(options.case, "fault requires an explicit case");
assert.ok(
  process.env.S1_EDIT_CONTEXT === undefined ||
    ["true", "false"].includes(process.env.S1_EDIT_CONTEXT),
);
mkdirSync(sources, { recursive: true });
// All runtime imports and installation reads use this immutable snapshot.
for (const name of [
  "run.mjs",
  "bounded-gates.mjs",
  "matrix",
  "leader",
  "probe",
  "load",
  "ready",
  "dock",
  "wayland",
])
  cpSync(join(source, name), join(sources, name), {
    recursive: true,
    filter: (file) =>
      !file.split(/[\\/]/).includes("__pycache__") && !file.endsWith(".pyc"),
  });
const { buildMatrixRunner } = await import(
  pathToFileURL(join(sources, "matrix/runner.mjs")).href
);
const { buildMatrixBounded } = await import(
  pathToFileURL(join(sources, "matrix/bounded.mjs")).href
);
options.observe = [
  "entry-exit",
  "query",
  "count",
  "fault",
  "vb-entry",
  "vb-pause",
  "hangul",
  "restart",
  "cold",
  "focus",
].includes(options.row);
const baseline = readFileSync(join(sources, "run.mjs"));
const temporary = mkdtempSync(join(tmpdir(), "s1-matrix-runner-"));
const bounded = join(temporary, "bounded-gates.mjs");
writeFileSync(
  bounded,
  buildMatrixBounded(readFileSync(join(sources, "bounded-gates.mjs"))),
);
const generated = buildMatrixRunner(
  baseline,
  sources,
  options,
  pathToFileURL(bounded).href,
);
if (options.backend === "wayland") {
  const { buildWaylandRunner } = await import(
    pathToFileURL(join(sources, "matrix/wayland-runner.mjs")).href
  );
  generated.code = buildWaylandRunner(generated.code, sources);
}
const script = join(temporary, "run.mjs");
writeFileSync(script, generated.code);
execFileSync(process.execPath, ["--check", script]);
writeFileSync(
  join(sources, "matrix-options.json"),
  JSON.stringify(
    { ...options, runnerBaselineSha256: generated.baselineSha256 },
    null,
    2,
  ) + "\n",
);
const { processIdentity, readOwned, signalOwned, terminateOwned } =
  await import(pathToFileURL(join(sources, "matrix/lifecycle.mjs")).href);
const ledger = join(temporary, "owned-processes.json");
const child = spawn(
  options.cpuSet ? "taskset" : process.execPath,
  options.cpuSet
    ? ["--cpu-list", options.cpuSet, process.execPath, script, output]
    : [script, output],
  {
    env: { ...process.env, S1_GATE: options.row, S1_PROCESS_LEDGER: ledger },
    detached: true,
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  },
);
const runnerIdentity = child.pid ? processIdentity(child.pid) : null;
const ownedMessages = new Map();
child.on("message", (message) => {
  if (message?.s1Ownership && message.writerPid === child.pid)
    for (const group of message.groups) {
      if (
        !Number.isSafeInteger(group.pid) ||
        group.pid !== group.group ||
        !/^\d+$/.test(group.startTicks)
      ) {
        wrapperError = "invalid ownership identity";
        requestStop("SIGTERM");
        return;
      }
      ownedMessages.set(group.group, group);
    }
});
let stopSignal, fallbackTimer, cleanupPromise, wrapperError;
const cleanup = () => {
  let recorded = [];
  try {
    recorded = readOwned(ledger, child.pid);
  } catch (error) {
    wrapperError = String(error);
  }
  return terminateOwned([
    ...recorded,
    ...ownedMessages.values(),
    runnerIdentity,
  ]);
};
function requestStop(signal) {
  stopSignal ??= signal;
  try {
    if (runnerIdentity) signalOwned(runnerIdentity, signal);
  } catch (error) {
    wrapperError = String(error);
  }
  fallbackTimer ??= setTimeout(() => {
    cleanupPromise = cleanup().catch((error) => {
      wrapperError = String(error);
    });
  }, 3000);
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => requestStop(signal));
let status;
try {
  status = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} catch (error) {
  wrapperError = String(error);
  status = 1;
} finally {
  clearTimeout(fallbackTimer);
  let cleaned;
  let nativeCleanup;
  try {
    const fallback = await cleanupPromise;
    cleaned = await cleanup();
    if (fallback) cleaned.fallback = fallback;
    if (existsSync(ledger + ".wayland.json")) {
      const ownership = JSON.parse(readFileSync(ledger + ".wayland.json"));
      assert.equal(ownership.writerPid, child.pid);
      const { cleanPrivateWayland } = await import(
        pathToFileURL(join(sources, "matrix/wayland-session.mjs")).href
      );
      nativeCleanup = cleanPrivateWayland(ownership.root);
    }
  } catch (error) {
    wrapperError = String(error);
  }
  writeFileSync(
    termination,
    JSON.stringify(
      {
        finished: new Date().toISOString(),
        exitCode: status,
        stopSignal,
        wrapperError,
        cleanup: cleaned,
        nativeCleanup,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  process.exitCode = stopSignal
    ? 130
    : wrapperError ||
        cleaned?.remaining.length ||
        nativeCleanup?.remaining.length ||
        nativeCleanup?.errors.length
      ? 1
      : status;
}
