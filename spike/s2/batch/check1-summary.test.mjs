import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = join(import.meta.dirname, "check1-summary.mjs");
const build = { id: "synthetic-summary-regression", dirty: [] };
const cards = [
  { id: "normal []", rows: [{ key: "x" }, { key: "j" }] },
  { id: 'normal ["g"]', rows: [{ key: "x" }, { key: "j" }] },
];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "s2-summary-test-")),
    files = [];
  mkdirSync(join(dir, "input"));
  for (const set of ["defaults", "extensions"]) {
    writeFileSync(
      join(dir, "input", `correctness-${set}.json`),
      JSON.stringify(cards),
    );
    writeFileSync(join(dir, "input", `excluded-${set}.json`), "[]");
    for (const version of ["1.134.0", "1.141.0"])
      for (const [index, card] of cards.entries()) {
        const file = join(dir, `${set}-${version}-c${index}.jsonl`);
        write(file, [
          {
            type: "meta",
            version,
            set,
            trials: 3,
            cards: [card.id],
            only: `#${index}-${index + 1}`,
            build,
            hello: {
              vscode: version,
              vim: { version: "1.32.4" },
              whichkey: { version: "0.11.4" },
            },
          },
          ...card.rows.flatMap((row) =>
            [0, 1, 2].map((trial) => ({
              type: "trial",
              card: card.id,
              key: row.key,
              trial,
              ok: true,
              diff: [],
            })),
          ),
          { type: "end" },
        ]);
        files.push(file);
      }
  }
  return { dir, files };
}
const read = (file) =>
  readFileSync(file, "utf8").trim().split("\n").map(JSON.parse);
const write = (file, records) =>
  writeFileSync(file, records.map(JSON.stringify).join("\n") + "\n");
const run = (dir) =>
  execFileSync(process.execPath, [script, dir], { encoding: "utf8" });
function check(title, mutate, expectedProblem) {
  test(title, () => {
    const f = fixture();
    try {
      mutate(f);
      const output = run(f.dir);
      assert.match(output, /^ROW check1: .*: not pass$/m);
      if (expectedProblem) assert.match(output, expectedProblem);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  });
}

test("a complete four-condition matrix with disjoint chunks passes", () => {
  const f = fixture();
  try {
    assert.match(run(f.dir), /^ROW check1: .*: pass$/m);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
check(
  "a retained error cannot be hidden by passing trials",
  ({ files }) => {
    const a = read(files[0]);
    a.splice(-1, 0, {
      type: "error",
      version: a[0].version,
      set: a[0].set,
      build,
      phase: "trials",
      error: "synthetic failure",
    });
    write(files[0], a);
  },
  /1 error records/,
);
check(
  "an interrupted file without end cannot pass",
  ({ files }) => write(files[0], read(files[0]).slice(0, -1)),
  /one final end record/,
);
check(
  "duplicate end records cannot pass",
  ({ files }) => write(files[0], [...read(files[0]), { type: "end" }]),
  /one final end record/,
);
check(
  "duplicate metadata cannot pass",
  ({ files }) => {
    const a = read(files[0]);
    write(files[0], [a[0], ...a]);
  },
  /one initial meta record/,
);
check(
  "metadata after a trial cannot pass",
  ({ files }) => {
    const a = read(files[0]);
    [a[0], a[1]] = [a[1], a[0]];
    write(files[0], a);
  },
  /one initial meta record/,
);
check(
  "duplicate trial IDs do not replace a missing repetition",
  ({ files }) => {
    const a = read(files[0]);
    a[3] = a[2];
    write(files[0], a);
  },
  /duplicate trial/,
);
check(
  "a fourth trial cannot silently extend the matrix",
  ({ files }) => {
    const a = read(files[0]);
    a.splice(-1, 0, { ...a[1], trial: 3 });
    write(files[0], a);
  },
  /invalid trial index/,
);
check(
  "declaring four trials does not change the criterion",
  ({ files }) => {
    const a = read(files[0]);
    a[0].trials = 4;
    write(files[0], a);
  },
  /needs exactly 3/,
);
check(
  "unexpected rows cannot hide outside the input",
  ({ files }) => {
    const a = read(files[0]);
    a.splice(-1, 0, { ...a[1], key: "unexpected" });
    write(files[0], a);
  },
  /trial outside input range/,
);
check(
  "duplicate input rows cannot share the same trials",
  ({ dir }) => {
    const copy = structuredClone(cards);
    copy[0].rows.push({ key: "x" });
    writeFileSync(
      join(dir, "input", "correctness-defaults.json"),
      JSON.stringify(copy),
    );
  },
  /duplicate input row/,
);
check(
  "a missing condition cannot pass",
  ({ files }) => {
    rmSync(files[0]);
    rmSync(files[1]);
  },
  /UNMEASURED/,
);
check(
  "an invalid metadata condition cannot be ignored",
  ({ files }) => {
    const a = read(files[0]);
    a[0].set = "unexpected";
    write(files[0], a);
  },
  /invalid condition/,
);
check(
  "metadata cards must match the chunk range",
  ({ files }) => {
    const a = read(files[0]);
    a[0].cards = [cards[1].id];
    write(files[0], a);
  },
  /meta cards differ/,
);
check(
  "overlapping chunks cannot supply each other's missing rows",
  ({ files }) => {
    const a = read(files[0]),
      b = read(files[1]);
    a[0].only = b[0].only = "#0-2";
    a[0].cards = b[0].cards = cards.map((c) => c.id);
    write(files[0], a);
    write(files[1], b);
  },
  /expected trial records missing from this chunk/,
);
check(
  "a pass flag with recorded differences cannot pass",
  ({ files }) => {
    const a = read(files[0]);
    a[1].diff = ["cursor"];
    write(files[0], a);
  },
  /passing trial contains differences/,
);
