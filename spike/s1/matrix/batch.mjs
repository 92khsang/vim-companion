import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  cpSync,
  existsSync,
  createWriteStream,
  readdirSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";

const plan = JSON.parse(readFileSync(process.argv[2], "utf8"));
const output = resolve(process.argv[3]);
assert.ok(!existsSync(output), "batch output must be unused");
assert.ok(Array.isArray(plan.jobs) && plan.jobs.length);
assert.ok(Array.isArray(plan.cpuSets) && plan.cpuSets.length);
const allCpus = new Set();
const topology = execFileSync("lscpu", ["-p=CPU,CORE,SOCKET"], {
  encoding: "utf8",
});
const physical = new Map(
  topology
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [cpu, core, socket] = line.split(",");
      return [Number(cpu), `${socket}:${core}`];
    }),
);
const owners = new Map();
for (const set of [...plan.cpuSets, ...(plan.externalCpuSets ?? [])]) {
  assert.match(set, /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/);
  for (const range of set.split(",")) {
    const [low, high = low] = range.split("-").map(Number);
    assert.ok(high >= low);
    for (let cpu = low; cpu <= high; cpu++) {
      assert.ok(!allCpus.has(cpu), "overlapping batch CPU sets");
      assert.ok(physical.has(cpu), "unknown CPU");
      assert.ok(
        !owners.has(physical.get(cpu)) || owners.get(physical.get(cpu)) === set,
        "SMT siblings assigned to different workers",
      );
      owners.set(physical.get(cpu), set);
      allCpus.add(cpu);
    }
  }
}
const codes = {
  "1.134.0": process.env.S1_CODE_1134,
  "1.141.0": process.env.S1_CODE_1141 ?? "/usr/share/code/code",
};
const globalLimit = plan.globalConcurrentLimit ?? plan.cpuSets.length;
assert.ok(
  Number.isSafeInteger(globalLimit) && globalLimit >= plan.cpuSets.length,
);
const ids = new Set();
for (const job of plan.jobs) {
  assert.match(job.id, /^[a-z0-9-]+$/);
  assert.ok(!ids.has(job.id));
  ids.add(job.id);
  assert.ok(codes[job.version], "missing version-pinned binary");
  if (job.cpuSet) assert.ok(plan.cpuSets.includes(job.cpuSet));
}
mkdirSync(output, { recursive: true });
const source = resolve(import.meta.dirname, "..");
const frozen = join(output, "sources");
mkdirSync(frozen);
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
  cpSync(join(source, name), join(frozen, name), {
    recursive: true,
    filter: (file) =>
      !file.split(/[\\/]/).includes("__pycache__") && !file.endsWith(".pyc"),
  });
const record = {
  started: new Date().toISOString(),
  maximumConcurrentInstances: plan.cpuSets.length,
  maximumConcurrentExperimentInstances: globalLimit,
  cpuTopology: topology,
  plan,
  runs: [],
};
const portable = (value) => value.replaceAll(process.env.HOME, "$HOME");
const save = () =>
  writeFileSync(
    join(output, "batch.json"),
    portable(JSON.stringify(record, null, 2)) + "\n",
  );
save();
let stopped = false;
const children = new Set();
const completions = new Map();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopped = true;
    for (const child of children) child.kill(signal);
  });
async function worker(cpuSet) {
  const jobs = plan.jobs.filter(
    (job, index) =>
      (job.cpuSet ?? plan.cpuSets[index % plan.cpuSets.length]) === cpuSet,
  );
  for (const job of jobs) {
    if (stopped) break;
    let run;
    try {
      const file = join(output, job.id + ".json");
      run = { id: job.id, cpuSet, started: new Date().toISOString() };
      record.runs.push(run);
      save();
      const env = {
        ...process.env,
        S1_MATRIX_VERSION: job.version,
        S1_MATRIX_ROW: job.row,
        S1_AFFINITY: job.affinity,
        S1_LOAD: job.load ? "1" : "0",
        S1_DELAY_MS: String(job.delay),
        S1_EDIT_CONTEXT: String(job.editContext ?? true),
        S1_CODE: codes[job.version],
        S1_CPUS: cpuSet,
        S1_INSTANCES: String(globalLimit),
        S1_BACKEND: job.backend ?? "x11",
        S1_ACCESSIBILITY: job.accessibility ?? "off",
      };
      delete env.S1_MATRIX_CASE;
      delete env.S1_FOCUS_FROM;
      delete env.S1_FOCUS_THROUGH;
      delete env.S1_BASELINE;
      if (job.case) env.S1_MATRIX_CASE = job.case;
      if (job.focusFrom) env.S1_FOCUS_FROM = job.focusFrom;
      if (job.focusThrough) env.S1_FOCUS_THROUGH = job.focusThrough;
      if (job.baseline) {
        env.S1_BASELINE = resolve(output, job.baseline);
        assert.ok(
          existsSync(env.S1_BASELINE),
          "comparison reference must exist before launch",
        );
        assert.ok(
          ["native-baseline-recorded", "visual-baseline-recorded"].includes(
            JSON.parse(readFileSync(env.S1_BASELINE, "utf8")).status,
          ),
          "comparison reference did not complete",
        );
      }
      const log = createWriteStream(join(output, job.id + ".log"), {
        flags: "wx",
      });
      const child = spawn(
        process.execPath,
        [join(frozen, "matrix/run.mjs"), file],
        { env, stdio: ["ignore", "pipe", "pipe"] },
      );
      children.add(child);
      log.on("error", (error) => {
        run.logError = String(error);
        stopped = true;
        child.kill("SIGTERM");
      });
      for (const stream of [child.stdout, child.stderr]) {
        const lines = createInterface({ input: stream });
        lines.on("line", (line) => log.write(portable(line) + "\n"));
      }
      const completion = new Promise((resolve) => {
        child.once("error", (error) => {
          run.error = String(error);
          resolve(1);
        });
        child.once("exit", (code, signal) => {
          run.signal = signal;
          resolve(code ?? 1);
        });
        child.once("close", (code) => resolve(code ?? 1));
      });
      completions.set(child, completion);
      const status = await completion;
      children.delete(child);
      completions.delete(child);
      log.end();
      run.exitCode = status;
      run.finished = new Date().toISOString();
      if (existsSync(file)) {
        const measured = JSON.parse(readFileSync(file, "utf8"));
        run.status = measured.status;
        run.trials = measured.trials.length;
        run.measuredStarted = measured.started;
        run.measuredFinished = measured.finished;
        run.ideLauncher = measured.matrix?.ideLauncher;
      }
      if (status !== 0 || run.status === "harness-error") stopped = true;
      save();
      console.log(
        `${run.id}: ${run.status ?? "launch-error"}, ${run.trials ?? 0} trials`,
      );
    } catch (error) {
      stopped = true;
      if (run) {
        run.error = String(error);
        run.status = "harness-error";
        run.finished = new Date().toISOString();
      }
      for (const child of children) child.kill("SIGTERM");
      try {
        save();
      } catch {}
      await Promise.allSettled(
        [...children].map((child) => completions.get(child)),
      );
    }
  }
}
if (process.env.S1_WAIT_FOR_PID) {
  const pid = Number(process.env.S1_WAIT_FOR_PID);
  assert.ok(Number.isSafeInteger(pid) && pid > 1);
  while (!stopped) {
    try {
      process.kill(pid, 0);
    } catch {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
for (const dependency of plan.waitForBatches ?? []) {
  const manifest = resolve(dependency);
  while (!stopped) {
    let prior;
    try {
      prior = JSON.parse(readFileSync(manifest));
    } catch {}
    if (prior?.finished) {
      for (const run of prior.runs) {
        const termination = JSON.parse(
          readFileSync(
            join(resolve(manifest, ".."), run.id + "-termination.json"),
          ),
        );
        assert.deepEqual(
          termination.cleanup?.remaining,
          [],
          "previous batch still has owned processes",
        );
        assert.deepEqual(
          termination.cleanup?.errors,
          [],
          "previous batch cleanup has errors",
        );
      }
      record.waitedForBatches ??= [];
      record.waitedForBatches.push({
        file: dependency,
        finished: prior.finished,
        verifiedAt: new Date().toISOString(),
      });
      save();
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
for (const dependency of plan.waitForRuns ?? []) {
  while (!stopped) {
    let prior;
    try {
      prior = JSON.parse(readFileSync(resolve(dependency)));
    } catch {}
    if (prior?.finished && prior.matrix?.ideLauncher?.finished) {
      record.waitedForRuns ??= [];
      record.waitedForRuns.push({ file: dependency, finished: prior.finished });
      save();
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
for (const cpus of plan.waitForCpuSets ?? []) {
  assert.ok(plan.cpuSets.includes(cpus));
  while (!stopped) {
    const owners = readdirSync("/proc")
      .filter((name) => /^\d+$/.test(name))
      .filter((name) => {
        try {
          const status = readFileSync(`/proc/${name}/status`, "utf8");
          return (
            !/^State:\s+Z/m.test(status) &&
            status.match(/^Cpus_allowed_list:\s*(.*)$/m)?.[1] === cpus
          );
        } catch {
          return false;
        }
      });
    if (!owners.length) {
      record.cpuReuseChecks ??= [];
      record.cpuReuseChecks.push({
        cpus,
        noRemainingAffinityOwnersAt: new Date().toISOString(),
      });
      save();
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
await Promise.all(plan.cpuSets.map(worker));
record.finished = new Date().toISOString();
record.stoppedOnHarnessError = stopped;
for (const run of record.runs)
  run.overlappingWrapperRuns = record.runs
    .filter(
      (other) =>
        other.id !== run.id &&
        Date.parse(other.started) < Date.parse(run.finished) &&
        Date.parse(other.finished) > Date.parse(run.started),
    )
    .map((other) => other.id);
record.notStarted = plan.jobs
  .filter((job) => !record.runs.some((run) => run.id === job.id))
  .map((job) => job.id);
save();
process.exitCode = stopped ? 1 : 0;
