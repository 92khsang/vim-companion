// Checks the cursor rule of lib.mjs (harnessCursor) on the sequences of observe-sequences.json:
//   cards <out.json>                     the sequences as cards for vim-check/expect.mjs (the last
//                                        key is the row, the keys before it the card's keys)
//   compare <oracle.jsonl[.gz]> <observe.json>
//                                        per VS Code trial of observe.mjs: Vim's mode and cursor
//                                        (converted for a Visual mode) against what the harness read
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { START } from "../harness/lib.mjs";
import { MAXCOL, harnessCursor } from "./lib.mjs";

const [what, a, b] = process.argv.slice(2);
const sequences = JSON.parse(
  readFileSync(join(import.meta.dirname, "observe-sequences.json"), "utf8"),
);
const MODE_AFTER = {
  v: "visual",
  V: "visual-line",
  "<C-v>": "visual-block",
  i: "insert",
};
if (what === "cards") {
  const cards = sequences.map((s) => {
    const keys = s.keys.slice(0, -1);
    const mode = keys.length ? (MODE_AFTER[keys[0]] ?? "normal") : "normal";
    // The card id gives expect.mjs the mode and the pending keys (none after a Visual motion).
    const pending = mode === "normal" ? keys : [];
    return {
      id: `${mode} ${JSON.stringify(pending)}`,
      title: s.name,
      keys,
      rows: [{ key: s.keys.at(-1), label: "" }],
    };
  });
  writeFileSync(a, JSON.stringify(cards, null, 1) + "\n");
} else if (what === "compare") {
  const raw = readFileSync(a);
  const vim = (a.endsWith(".gz") ? gunzipSync(raw) : raw)
    .toString()
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .filter((r) => r.type === "row" && r.class === "vim");
  const vs = JSON.parse(readFileSync(b, "utf8")).sequences;
  let agree = 0;
  let n = 0;
  for (const r of vim) {
    const e = r.expect;
    const lines =
      e.text === "unchanged"
        ? START.lines
        : Array.isArray(e.text)
          ? e.text
          : START.lines.map((l, i) => e.text[i] ?? l);
    const cursor = harnessCursor(
      {
        mode: e.mode,
        cursor: e.cursor,
        visualStart: [r.vim.vpos[1] - 1, r.vim.vpos[2] - 1],
        toLineEnd: r.vim.curswant === MAXCOL,
      },
      lines,
    );
    for (const o of vs.filter(
      (o) => JSON.stringify(o.keys) === JSON.stringify(r.typed),
    )) {
      n += 1;
      const ok =
        JSON.stringify(cursor) === JSON.stringify(o.cursor) &&
        e.mode === o.mode;
      if (ok) agree += 1;
      console.log(
        [
          ok ? "agree" : "differ",
          o.keys.join(" "),
          `trial ${o.trial}`,
          `vim ${e.mode} ${JSON.stringify(e.cursor)} -> ${JSON.stringify(cursor)}`,
          `vscode ${o.mode} ${JSON.stringify(o.cursor)}`,
        ].join("\t"),
      );
    }
  }
  console.log(`${agree} of ${n} trials agree in mode and cursor`);
} else
  throw new Error(
    "usage: observe-compare.mjs cards <out> | compare <oracle> <observe>",
  );
