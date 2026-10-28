// Observations for the rules of check (1) in one sandbox VS Code (defaults settings set):
// - the indentation options that VS Code gives the fixture buffer (editor.detectIndentation is not
//   pinned in the sandbox): the configured values through the probe and the status bar entry
//   `status.editor.indentation` over CDP, for a.txt and b.txt;
// - what cards-correctness.mjs reads (the primary selection's active position, the probe's mode,
//   the text) after the sequences of `observe-sequences.json`: shift keys, Visual-mode motions and
//   keys that end in the command line or a search prompt. Each sequence is typed like a check (1)
//   row: the reset keys, the probe reset to the fixture start, then the keys at 30 ms.
// Usage: node spike/s2/check1/observe.mjs <version> <display> <cdpPort> <out.json> [trials]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  START,
  cdpEvaluate,
  focusWindow,
  openSession,
  startXvfb,
  stopCode,
  typeKeys,
} from "../harness/lib.mjs";

const RESET_KEYS = ["<Esc>", "<Esc>", "v", "<Esc>"];
const STATUS_JS = `[...document.querySelectorAll('.statusbar-item')].map(e => [e.id, e.textContent.trim()]).filter(([id]) => /indentation|selection|vim/i.test(id))`;
const [version, display, cdpPort, outFile, trialsArg] = process.argv.slice(2);
const trials = Number(trialsArg ?? 2);
const sequences = JSON.parse(
  readFileSync(join(import.meta.dirname, "observe-sequences.json"), "utf8"),
);
const out = {
  version,
  set: "defaults",
  trials,
  started: new Date().toISOString(),
  indentation: [],
  sequences: [],
};
let xvfb, code;
const save = () => writeFileSync(outFile, JSON.stringify(out, null, 1) + "\n");
try {
  xvfb = await startXvfb(display);
  code = await openSession({
    version,
    display,
    name: `${process.env.S2_NAME_PREFIX ?? ""}observe-${version}-${display.slice(1)}`,
    cdpPort: Number(cdpPort),
    settings: {},
  });
  const files = [
    { path: join(code.inst, "ws/a.txt"), viewColumn: 1 },
    { path: join(code.inst, "ws/b.txt"), viewColumn: 2 },
  ];
  const config = {};
  for (const key of [
    "detectIndentation",
    "tabSize",
    "insertSpaces",
    "indentSize",
  ])
    config[`editor.${key}`] = await code.probe.call("config", {
      section: "editor",
      key,
    });
  for (const group of [2, 1]) {
    await code.probe.call("exec", {
      command:
        group === 1
          ? "workbench.action.focusFirstEditorGroup"
          : "workbench.action.focusSecondEditorGroup",
    });
    await sleep(500);
    const snap = await code.probe.call("snapshot");
    out.indentation.push({
      group,
      active: snap.active?.replace(/^.*\//, ""),
      config,
      statusBar: await cdpEvaluate(Number(cdpPort), STATUS_JS),
    });
  }
  for (const seq of sequences) {
    for (let trial = 0; trial < trials; trial++) {
      typeKeys(display, RESET_KEYS, 30);
      await sleep(80);
      let snap = await code.probe.call("snapshot");
      if (
        snap.editors.length !== 2 ||
        !snap.active?.endsWith("/a.txt") ||
        snap.activeViewColumn !== 1
      ) {
        await code.probe.call("exec", {
          command: "workbench.action.closeAllEditors",
        });
        await code.probe.call("open", { files });
        focusWindow(code);
        await code.probe.call("exec", {
          command: "workbench.action.focusFirstEditorGroup",
        });
      }
      await code.probe.call("reset", START);
      await sleep(200);
      typeKeys(display, seq.keys, 30);
      await sleep(400);
      snap = await code.probe.call("snapshot");
      const active =
        snap.editors.find(
          (e) =>
            e.uri === snap.active && e.viewColumn === snap.activeViewColumn,
        ) ?? snap.editors.find((e) => e.uri === snap.active);
      const vim = await code.probe.call("vimState");
      out.sequences.push({
        name: seq.name,
        keys: seq.keys,
        trial,
        activeFile: snap.active?.replace(/^.*\//, "") ?? null,
        mode: vim.state?.mode ?? null,
        rawMode: vim.fields?.mode ?? null,
        pending: vim.state?.pending ?? null,
        // What cards-correctness.mjs compares as the cursor: selections[0] from index 2.
        cursor: active ? active.selections[0].slice(2) : null,
        selections: active ? active.selections : null,
        text: active ? active.text.replace(/\n$/, "").split("\n") : null,
        statusBar: await cdpEvaluate(Number(cdpPort), STATUS_JS),
      });
    }
    save();
  }
  out.finished = new Date().toISOString();
} catch (e) {
  out.error = String(e.stack ?? e);
} finally {
  save();
  if (code) await stopCode(code);
  if (xvfb)
    try {
      process.kill(xvfb, "SIGTERM");
    } catch {}
}
