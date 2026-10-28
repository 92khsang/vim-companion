// Joins the worker files of oracle-run.mjs for one vimrc and settings set into one gzip JSONL in
// the row order of cards.json: one `meta` record (the first worker's, with every worker's start,
// finish, card count and Vim-row time), the `row` records, and one `end` record with the totals.
// Usage: node spike/s2/check1/oracle-merge.mjs <run dir> <vimrc base, e.g. expect> <set> <out.jsonl.gz> [cards.json]
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { REPO } from "../harness/lib.mjs";

const [runDir, base, set, outFile, cardsArg] = process.argv.slice(2);
const cardsFile = cardsArg ?? join(REPO, "spike/s2/cards/cards.json");
const cards = JSON.parse(readFileSync(cardsFile, "utf8"));
const order = new Map(cards.map((c, i) => [c.id, i]));
const rowOrder = new Map(
  cards.flatMap((c) => c.rows.map((r, j) => [`${c.id}\0${r.key}`, j])),
);
const pattern = new RegExp(`^${base}-${set}-p(\\d+)w(\\d+)\\.jsonl$`);
const files = readdirSync(runDir)
  .filter((f) => pattern.test(f))
  .sort();
if (!files.length) throw new Error(`no worker files for ${base}-${set}`);
const metas = [];
const ends = [];
const rows = [];
for (const f of files) {
  const [, part, worker] = pattern.exec(f);
  const records = readFileSync(join(runDir, f), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  const meta = records.find((r) => r.type === "meta");
  const end = records.find((r) => r.type === "end");
  if (!meta || !end) throw new Error(`${f}: no meta or end record`);
  const mine = records.filter((r) => r.type === "row");
  metas.push({
    part: Number(part),
    worker: Number(worker),
    started: meta.started,
    cards: new Set(mine.map((r) => r.card)).size,
    meta,
  });
  ends.push({ part: Number(part), worker: Number(worker), ...end });
  rows.push(...mine);
}
const sortKey = (r) => [order.get(r.card), rowOrder.get(`${r.card}\0${r.key}`)];
for (const r of rows)
  if (sortKey(r).some((k) => k === undefined))
    throw new Error(`row not in ${cardsFile}: ${r.card} ${r.key}`);
rows.sort((a, b) => {
  const [ca, ra] = sortKey(a);
  const [cb, rb] = sortKey(b);
  return ca - cb || ra - rb;
});
const first = metas[0].meta;
const { cards: _subset, started: _started, ...common } = first;
const meta = {
  ...common,
  cards: relative(REPO, cardsFile),
  started: metas.map((m) => m.started).sort()[0],
  workers: metas.map(({ part, worker, started, cards: n }) => ({
    part,
    worker,
    started,
    cards: n,
  })),
};
for (const m of metas)
  for (const k of ["vim", "vimrc", "command", "tmux", "cpus", "set"])
    if (JSON.stringify(m.meta[k]) !== JSON.stringify(first[k]))
      throw new Error(`workers differ in ${k}`);
const times = rows.filter((r) => r.ms).map((r) => r.ms.total);
const sorted = [...times].sort((a, b) => a - b);
const end = {
  type: "end",
  finished: ends
    .map((e) => e.finished)
    .sort()
    .at(-1),
  rows: rows.length,
  vimRows: times.length,
  msTotal: times.reduce((a, b) => a + b, 0),
  msMedian: sorted[Math.floor(sorted.length / 2)] ?? null,
  msMax: sorted.at(-1) ?? null,
  workers: ends.map(({ part, worker, finished, vimRows, msTotal }) => ({
    part,
    worker,
    finished,
    vimRows,
    msTotal,
  })),
};
// The work directory of a row (in a <C-g> message, for example) is a random temporary name.
const text = (
  [meta, ...rows, end].map((r) => JSON.stringify(r)).join("\n") + "\n"
).replace(/\/tmp\/s2x\.[A-Za-z0-9]{6}/g, "<work>");
// No local path: the home directory, the sandbox root and run directory, a private temp dir.
const tmp = tmpdir();
for (const bad of [
  process.env.HOME,
  process.env.S2_ROOT,
  process.env.S2_RUN,
  tmp === "/tmp" ? null : tmp,
])
  if (bad && text.includes(bad))
    throw new Error(`the output names ${bad}; refusing to write it`);
writeFileSync(outFile, gzipSync(text, { level: 9 }));
console.log(
  `${base} ${set}: ${rows.length} rows (${times.length} Vim rows) from ${files.length} workers -> ${outFile}`,
);
