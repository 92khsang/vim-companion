// Polling CPU of candidate (a): utime + stime of the extension host process, read from
// /proc/<pid>/stat at the start and end of each window, in two scenarios:
//   idle:   a.txt open in Normal mode, no input
//   typing: the differential script in a loop at 30 ms injected key delay
// Each window runs in its own sandbox session, with the adapter on or disabled by --disable-extension.
// Usage: node spike/s2/harness/cpu.mjs <version> <display> <scenario idle|typing> <arm on|off> <minutes> <out.jsonl>
//
// Before the window opens, the input check of every row: `l h` must reach a.txt (two selection
// events), up to three attempts with a refocus between them. In the typing scenario each loop of the
// script starts in the first editor group with a.txt reset to the start state, and the probe's
// editor events are counted per loop; in the idle scenario they are counted over the window. The
// probe reads the adapter at the start and the end of the window in both arms (the same probe work
// in both); with the adapter on, its count of completed polls must grow by at least 90% of the
// window over its poll interval (it polled through the window), and the check at the end
// (lib.mjs adapterCheck) needs a fresh report for the active editor and a neutral Normal state.
// The busy time of the S2_CPUS cores (/proc/stat) is read at the start and end of the window
// together with the CPU time of this session's own processes that are pinned to those cores; the
// rest is load from elsewhere on them. The record also holds the busy share of every core, of every
// Hyper-Threading pair the cores belong to, and of the pairs' cores outside S2_CPUS.
//
// A window is `valid` when every check passes. An invalid window is `rerunnable` only when its
// reasons are another sandbox of the harness on cores that overlap S2_CPUS (sampled at the start,
// after every loop or every 30 s, and at the end) or load from elsewhere on the cores of at least
// 50% of one core; an error record is rerunnable only in the phase `boot` (before the probe's first
// hello) and only with the adapter off: with the adapter on, the adapter is loaded before that hello
// (both activate on onStartupFinished), so an on-arm boot error counts against the row. Every other
// failure (the input check, an adapter check, the typing evidence, the polling, an error after the
// probe's hello) counts against the row in cpu-summary.mjs, and
// spike/s2/batch/cpu.sh does not run such a window again. The record carries the build (lib.mjs
// buildInfo), the probe's hello and CLK_TCK as read at run time.
import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  REPO,
  START,
  CPUS,
  cpuList,
  portable,
  buildInfo,
  adapterCheck,
  startXvfb,
  openSession,
  stopCode,
  typeKeys,
  focusWindow,
} from "./lib.mjs";

const [version, display, scenario, arm, minutesArg, outFile] =
  process.argv.slice(2);
const script = JSON.parse(
  readFileSync(join(REPO, "spike/s2/harness/differential-script.json"), "utf8"),
);
const CLK_TCK = Number(
  execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }),
);
const FOREIGN_LIMIT = 0.5; // of one core
const POLL_SHARE = 0.9;
const write = (rec) =>
  appendFileSync(outFile, portable(JSON.stringify(rec)) + "\n");
// Fields after the command name: state is field 3, pgrp 5, utime 14, stime 15 (proc(5)).
const statFields = (pid) => {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return stat.slice(stat.lastIndexOf(")") + 2).split(" ");
};
const ticks = (pid) => {
  const f = statFields(pid);
  return Number(f[11]) + Number(f[12]);
};
const allowedCores = (pid) =>
  cpuList(
    readFileSync(`/proc/${pid}/status`, "utf8")
      .split("\n")
      .find((l) => l.startsWith("Cpus_allowed_list:"))
      .split(/\s+/)[1],
  );
/** CPU ticks per pid of the VS Code process group, for the processes pinned to the cores. */
const ownTicks = (pgid, cores) => {
  const out = new Map();
  for (const d of readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const f = statFields(d);
      if (Number(f[2]) !== pgid) continue;
      if (!allowedCores(d).every((c) => cores.includes(c))) continue;
      out.set(d, Number(f[11]) + Number(f[12]));
    } catch {}
  }
  return out;
};
/** Busy ticks per core (user nice system irq softirq steal). */
const coreBusy = () => {
  const out = new Map();
  for (const l of readFileSync("/proc/stat", "utf8").split("\n")) {
    const m = /^cpu(\d+) (.*)$/.exec(l);
    if (!m) continue;
    const f = m[2].trim().split(/\s+/).map(Number);
    out.set(Number(m[1]), f[0] + f[1] + f[2] + f[5] + f[6] + f[7]);
  }
  return out;
};
const siblingsOf = (c) =>
  cpuList(
    readFileSync(
      `/sys/devices/system/cpu/cpu${c}/topology/thread_siblings_list`,
      "utf8",
    ).trim(),
  );
/** Processes of another sandbox of the harness (another XDG_RUNTIME_DIR under S2_RUN) that may run on these cores. */
const otherSandboxes = (cores, ownRt) => {
  const run = process.env.S2_RUN;
  const seen = new Set();
  for (const d of readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    let rt;
    try {
      rt = readFileSync(`/proc/${d}/environ`, "utf8")
        .split("\0")
        .find((v) => v.startsWith("XDG_RUNTIME_DIR="))
        ?.slice("XDG_RUNTIME_DIR=".length);
    } catch {
      continue;
    }
    if (!rt || !run || !rt.startsWith(run + "/") || rt === ownRt) continue;
    try {
      if (allowedCores(d).some((c) => cores.includes(c)))
        seen.add(rt.slice(run.length + 1));
    } catch {}
  }
  return [...seen];
};
const editorEvents = (ev) =>
  ev.filter((e) => e.type === "selection" || e.type === "text").length;

let xvfb, code;
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, async () => {
    if (code) await stopCode(code);
    if (xvfb)
      try {
        process.kill(xvfb, "SIGTERM");
      } catch {}
    process.exit(1);
  });
}
let phase = "boot";
let build;
try {
  build = buildInfo();
  xvfb = await startXvfb(display);
  code = await openSession({
    version,
    display,
    name: `${process.env.S2_NAME_PREFIX ?? ""}cpu-${scenario}-${arm}-${version}-${display.slice(1)}`,
    spikeExtensions: ["s2-probe", "s2-adapter"],
    disable: arm === "off" ? ["vim-companion-spike.s2-adapter"] : [],
    onHostUp: () => {
      phase = "start";
    },
  });
  await code.probe.call("reset", START);
  // The input check: l h must reach a.txt and leave the cursor where it was.
  let inputOk = false;
  for (let attempt = 0; attempt < 3 && !inputOk; attempt++) {
    await code.probe.call("events", { clear: true });
    typeKeys(display, ["l", "h"], 30);
    await sleep(400);
    const ev = await code.probe.call("events");
    inputOk =
      ev.filter((e) => e.type === "selection" && e.uri.endsWith("/a.txt"))
        .length >= 2;
    if (!inputOk) {
      focusWindow(code);
      await code.probe.call("exec", {
        command: "workbench.action.focusFirstEditorGroup",
      });
      await sleep(300);
    }
  }
  if (!inputOk)
    throw new Error("input check failed: l h did not reach the editor");
  await sleep(5000); // let start-up work finish before the window opens
  phase = "window";
  const pid = code.hello.pid;
  const cores = cpuList(CPUS());
  const pairs = [...new Set(cores.map((c) => siblingsOf(c).join(",")))].map(
    (p) => p.split(",").map(Number),
  );
  const outside = [...new Set(pairs.flat().filter((c) => !cores.includes(c)))];
  await code.probe.call("events", { clear: true });
  const a0 = await code.probe.call("adapter");
  const own0 = ownTicks(code.pid, cores);
  const busy0 = coreBusy();
  const t0 = Date.now();
  const c0 = ticks(pid);
  const end = t0 + Number(minutesArg) * 60000;
  const others = new Set();
  let samples = 0;
  const sample = () => {
    for (const o of otherSandboxes(cores, code.rt)) others.add(o);
    samples += 1;
  };
  sample();
  let loops = 0;
  const eventsPerLoop = [];
  const itemsPerLoop = [];
  if (scenario === "typing") {
    while (Date.now() < end) {
      await code.probe.call("exec", {
        command: "workbench.action.focusFirstEditorGroup",
      });
      await code.probe.call("reset", START);
      let items = 0;
      for (const item of script.items) {
        if (Date.now() >= end) break;
        typeKeys(display, item.keys, 30);
        items += 1;
        await sleep(200);
      }
      typeKeys(display, ["<Esc>", "<Esc>"], 30);
      eventsPerLoop.push(
        editorEvents(await code.probe.call("events", { clear: true })),
      );
      itemsPerLoop.push(items);
      loops += 1;
      sample();
    }
  } else {
    while (Date.now() < end) {
      await sleep(Math.min(30000, end - Date.now()));
      sample();
    }
  }
  const c1 = ticks(pid);
  const t1 = Date.now();
  const busy1 = coreBusy();
  const own1 = ownTicks(code.pid, cores);
  const a1 = await code.probe.call("adapter");
  const idleEvents =
    scenario === "idle"
      ? editorEvents(await code.probe.call("events", { clear: true }))
      : null;
  phase = "read";
  await sleep(200); // the adapter polls after the last <Esc> <Esc> before the end check
  const snap = await code.probe.call("snapshot");
  const adapter = await adapterCheck(code, arm, {
    activeUri: snap.active,
    neutral: true,
  });
  const wallMs = t1 - t0;
  const delta = (cs) =>
    cs.reduce((s, c) => s + (busy1.get(c) - busy0.get(c)), 0);
  const share = (t) => (t * 1000) / CLK_TCK / wallMs;
  const busyTicks = delta(cores);
  let ownDelta = 0;
  for (const [p, t] of own1) ownDelta += t - (own0.get(p) ?? 0);
  const foreignMs = (Math.max(0, busyTicks - ownDelta) * 1000) / CLK_TCK;
  const pollsInWindow =
    a0.polls !== null && a1.polls !== null && a0.polls !== undefined
      ? a1.polls - a0.polls
      : null;
  const pollsWanted = (POLL_SHARE * wallMs) / (a1.pollMs ?? 50);
  const invalid = [];
  const fail = (kind, text) => invalid.push({ kind, text });
  if (!adapter.ok) for (const r of adapter.reasons) fail("adapter-check", r);
  if (arm === "on" && !(pollsInWindow >= pollsWanted))
    fail(
      "polling",
      `the adapter completed ${pollsInWindow} polls in the window, fewer than ${Math.ceil(pollsWanted)}`,
    );
  if (
    scenario === "typing" &&
    !(loops > 0 && eventsPerLoop.every((n, j) => n >= itemsPerLoop[j]))
  )
    fail(
      "typing-evidence",
      `fewer editor events than items in a loop (events ${eventsPerLoop.join(",")}; items ${itemsPerLoop.join(",")})`,
    );
  if (scenario === "idle" && idleEvents !== 0)
    fail("idle-events", `${idleEvents} editor events in the idle window`);
  if (others.size)
    fail(
      "other-sandbox",
      `another sandbox on cores ${CPUS()}: ${[...others].join(", ")}`,
    );
  if (foreignMs / wallMs >= FOREIGN_LIMIT)
    fail(
      "outside-load",
      `load from elsewhere on cores ${CPUS()}: ${((foreignMs / wallMs) * 100).toFixed(1)}% of one core`,
    );
  const RERUNNABLE = new Set(["other-sandbox", "outside-load"]);
  write({
    version,
    scenario,
    arm,
    build,
    hello: code.hello,
    adapter: code.hello.adapter,
    adapterCheck: adapter,
    pid,
    minutes: Number(minutesArg),
    wallMs,
    clkTck: CLK_TCK,
    cpuTicks: c1 - c0,
    cpuMs: ((c1 - c0) * 1000) / CLK_TCK,
    loops,
    editorEvents:
      scenario === "typing"
        ? eventsPerLoop.reduce((s, n) => s + n, 0)
        : idleEvents,
    eventsPerLoop: scenario === "typing" ? eventsPerLoop : undefined,
    itemsPerLoop: scenario === "typing" ? itemsPerLoop : undefined,
    polls: {
      start: a0.polls ?? null,
      end: a1.polls ?? null,
      inWindow: pollsInWindow,
      wanted: arm === "on" ? Math.ceil(pollsWanted) : null,
    },
    cores: {
      list: CPUS(),
      busyMs: (busyTicks * 1000) / CLK_TCK,
      ownMs: (ownDelta * 1000) / CLK_TCK,
      foreignMs,
      foreignShare: foreignMs / wallMs,
      perCore: Object.fromEntries(cores.map((c) => [c, share(delta([c]))])),
      pairs: pairs.map((p) => ({
        cores: p.join(","),
        busyShare: share(delta(p)),
      })),
      siblingsOutside: {
        list: outside.join(","),
        busyShare: outside.length ? share(delta(outside)) : 0,
      },
      otherSandboxes: [...others],
      samples,
    },
    valid: invalid.length === 0,
    rerunnable:
      invalid.length > 0 && invalid.every((x) => RERUNNABLE.has(x.kind)),
    invalid: invalid.map((x) => `${x.kind}: ${x.text}`),
    started: new Date(t0).toISOString(),
  });
} catch (e) {
  write({
    version,
    scenario,
    arm,
    build,
    phase,
    valid: false,
    rerunnable: phase === "boot" && arm === "off",
    error: String(e.stack ?? e)
      .split("\n")
      .slice(0, 3)
      .join(" | "),
  });
} finally {
  if (code) await stopCode(code);
  if (xvfb)
    try {
      process.kill(xvfb, "SIGTERM");
    } catch {}
}
