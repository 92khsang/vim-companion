// Cross-checks the hand-written Vim states of spec/fixtures/grammar against Vim itself.
// Vim runs in a private tmux server; a timer in the vimrc writes mode(1), state() and
// v:operator to a log every 20 ms, and the showcmd area of the screen gives the pending keys.
// Usage: node spike/s2/vim-check/check.mjs <work dir> > result.txt
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const root = join(import.meta.dirname, "../../..");
const work = process.argv[2];
mkdirSync(work, { recursive: true });
const sock = join(work, "tmux.sock");
const conf = join(work, "tmux.conf");
writeFileSync(conf, "set -sg escape-time 0\n");
const tmux = (...args) =>
  execFileSync("tmux", ["-S", sock, "-f", conf, ...args], { encoding: "utf8" });
const tmuxKey = (key) => {
  const named = {
    "<Esc>": "Escape",
    "<C-w>": "C-w",
    "<C-v>": "C-v",
    "<Space>": "Space",
    "<CR>": "Enter",
  };
  return named[key]
    ? ["send-keys", "-t", "s2", named[key]]
    : ["send-keys", "-t", "s2", "-l", key];
};
const showcmdText = (key) =>
  key
    .replace(/^<C-([a-z])>$/, (_, c) => "^" + c.toUpperCase())
    .replace("<Esc>", "^[");

const WIDTH = 100;
let mismatches = 0;
let reads = 0;
const dir = join(root, "spec/fixtures/grammar");
for (const name of readdirSync(dir)
  .filter((n) => n.endsWith(".json"))
  .sort()) {
  const data = JSON.parse(readFileSync(join(dir, name), "utf8"));
  const file = join(work, "buffer.txt");
  writeFileSync(file, data.start.lines.join("\n") + "\n");
  for (const c of data.cases) {
    const log = join(work, "vim.log");
    writeFileSync(log, "");
    tmux(
      "new-session",
      "-d",
      "-s",
      "s2",
      "-x",
      String(WIDTH),
      "-y",
      "12",
      "-e",
      `S2_LOG=${log}`,
      `vim -u ${join(import.meta.dirname, "vimrc")} -i NONE -N -n ${file}`,
    );
    for (let i = 0; i < 100 && readFileSync(log, "utf8") === ""; i++)
      await sleep(20);
    await sleep(200);
    const read = async (label, expect) => {
      const screen = tmux("capture-pane", "-p", "-t", "s2").split("\n");
      const last = screen[11] ?? "";
      const showcmd = last.slice(WIDTH - 11).trim();
      const [mode, state, op] = readFileSync(log, "utf8").trim().split("|");
      const wantPending = expect.pending.map(showcmdText).join("");
      const visual = expect.mode.startsWith("visual");
      const pendingOk =
        showcmd === wantPending ||
        (visual && wantPending === "" && /^\d+(x\d+)?$/.test(showcmd));
      const wantMode = {
        normal: expect.operator ? "no" : "n",
        insert: "i",
        visual: "v",
        "visual-line": "V",
        "visual-block": "\x16",
      }[expect.mode];
      const modeOk =
        mode === wantMode || (expect.operator && mode.startsWith("no"));
      const opOk = !expect.operator || op === expect.operator;
      const ok = pendingOk && modeOk && opOk;
      reads += 1;
      if (!ok) mismatches += 1;
      console.log(
        `${ok ? "ok  " : "DIFF"} ${name.replace(".json", "")}/${c.id} ${label}: showcmd=${JSON.stringify(showcmd)} want=${JSON.stringify(wantPending)} mode(1)=${JSON.stringify(mode)} want=${JSON.stringify(wantMode)} state=${JSON.stringify(state)} v:operator=${JSON.stringify(op)} wantOp=${JSON.stringify(expect.operator)}`,
      );
    };
    for (const [i, step] of c.steps.entries()) {
      tmux(...tmuxKey(step.key));
      await sleep(300);
      await read(`after ${step.key} (#${i + 1})`, step.expect);
    }
    if (c.afterTimeout) {
      await sleep(1300);
      await read("after timeout", c.afterTimeout.expect);
    }
    tmux("kill-session", "-t", "s2");
  }
}
try {
  tmux("kill-server");
} catch {}
console.log(
  `${reads} reads, ${mismatches} mismatches; ${execFileSync("vim", ["--version"], { encoding: "utf8" }).split("\n").slice(0, 2).join(" / ")}`,
);
