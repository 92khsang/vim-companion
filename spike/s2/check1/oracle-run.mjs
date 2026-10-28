// Runs the Vim oracle (spike/s2/vim-check/expect.mjs) over the cards of one settings set with
// several private tmux servers at once. The cards are split into `parts` parts of about equal
// Vim-row counts (expect.mjs's own classification) and part `part` is run on `workers` workers,
// each a separate expect.mjs with its own short work directory and its own subset of the cards.
// Every worker writes <outDir>/<vimrc>-<set>-p<part>w<worker>.jsonl; oracle-merge.mjs joins them.
// Vim runs pinned to S2_VIM_CPUS (default 28-31); S2_VIMRC picks the vimrc (default expect.vimrc).
// Usage: node spike/s2/check1/oracle-run.mjs <set> <workers> <outDir> [<part>/<parts>] [cards.json]
import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { REPO } from "../harness/lib.mjs";
import { SETTINGS_SETS } from "../harness/cards-extract.mjs";
import { classify, holds } from "../vim-check/expect.mjs";
import { DEFAULTS } from "./lib.mjs";

const [set, workersArg, outDir, partArg = "1/1", cardsArg] =
  process.argv.slice(2);
if (!SETTINGS_SETS[set]) throw new Error(`unknown settings set ${set}`);
const [part, parts] = partArg.split("/").map(Number);
const workers = Number(workersArg);
const cardsFile = cardsArg ?? join(REPO, "spike/s2/cards/cards.json");
const vimrc = process.env.S2_VIMRC ?? "expect.vimrc";
const config = { ...DEFAULTS, ...SETTINGS_SETS[set] };
const cards = JSON.parse(readFileSync(cardsFile, "utf8"));
const weight = (card) =>
  card.rows.filter(
    (r) => holds(r.when, config) && classify(card, r, config).class === "vim",
  ).length;

/** Longest-processing-time split of the items into n bins by weight; bins keep the input order. */
function split(items, n) {
  const bins = Array.from({ length: n }, () => ({ w: 0, items: [] }));
  for (const it of [...items].sort((a, b) => b.w - a.w)) {
    bins.sort((a, b) => a.w - b.w);
    bins[0].items.push(it);
    bins[0].w += it.w;
  }
  return bins.map((b) => ({
    w: b.w,
    items: b.items.sort((a, b) => a.index - b.index),
  }));
}
const items = cards.map((card, index) => ({ card, index, w: weight(card) }));
const mine = split(items, parts)[part - 1].items;
const bins = split(mine, workers);
mkdirSync(outDir, { recursive: true });
const base = vimrc.replace(/\.vimrc$/, "");
const t0 = Date.now();
const results = await Promise.all(
  bins.map(
    (bin, i) =>
      new Promise((resolve) => {
        const work = mkdtempSync("/tmp/s2x.");
        const subset = join(work, "cards.json");
        writeFileSync(subset, JSON.stringify(bin.items.map((it) => it.card)));
        const out = join(outDir, `${base}-${set}-p${part}w${i + 1}.jsonl`);
        const child = spawn(
          process.execPath,
          [join(REPO, "spike/s2/vim-check/expect.mjs"), work, set, subset, out],
          { stdio: ["ignore", "pipe", "pipe"], env: process.env },
        );
        let log = "";
        child.stdout.on("data", (d) => (log += d));
        child.stderr.on("data", (d) => (log += d));
        child.on("close", (code) => {
          rmSync(work, { recursive: true, force: true });
          resolve({
            worker: i + 1,
            code,
            cards: bin.items.length,
            vimRows: bin.w,
            ms: Date.now() - t0,
            log: log.trim().split("\n").slice(-3),
          });
        });
      }),
  ),
);
console.log(
  JSON.stringify({
    set,
    vimrc,
    part: `${part}/${parts}`,
    workers,
    cards: mine.length,
    vimRows: mine.reduce((n, it) => n + it.w, 0),
    ms: Date.now() - t0,
    results,
  }),
);
