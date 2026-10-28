import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import { buildFullInput, PRODUCTS, verifyMatrix } from "./check1-verify.mjs";
import { SETTINGS_SETS } from "../harness/cards-extract.mjs";
import { START } from "../harness/lib.mjs";

// This is synthetic acceptance evidence, never an IDE result. Use the actual strict input so a
// focused smoke fixture cannot accidentally exercise only the verifier's happy-path counters.
const head = "1".repeat(40);
const build = {
  head,
  dirty: [],
  sha256: Object.fromEntries(
    ["adapter", "probe", "script", "harness", "remaps", "whichkey"].map(
      (key) => [key, "a".repeat(64)],
    ),
  ),
  external: {
    code: Object.fromEntries(
      Object.entries(PRODUCTS).map(([version, commit]) => [
        version,
        { version, commit },
      ]),
    ),
    extBase: "b".repeat(64),
    extBaseFolders: ["vscodevim.vim-1.32.4", "vspacecode.whichkey-0.11.4"],
  },
};
build.id = createHash("sha256")
  .update(
    JSON.stringify({
      head,
      dirty: "",
      sha256: build.sha256,
      external: build.external,
    }),
  )
  .digest("hex")
  .slice(0, 16);
let dir, input, first, negativeFile;
const write = (file, records) =>
  writeFileSync(file, records.map(JSON.stringify).join("\n") + "\n");
const read = (file) =>
  readFileSync(file, "utf8").trim().split("\n").map(JSON.parse);
const textOf = (e) => {
  if (e.text === "unchanged") return START.lines;
  if (Array.isArray(e.text)) return e.text;
  const lines = [...START.lines];
  for (const [index, line] of Object.entries(e.text))
    lines[Number(index)] = line;
  return lines.filter((line) => line !== null);
};
before(() => {
  input = buildFullInput();
  dir = mkdtempSync(join(tmpdir(), "s2-full-verifier-test-"));
  mkdirSync(join(dir, "input"));
  for (const [set, all] of Object.entries(input)) {
    writeFileSync(
      join(dir, "input", `correctness-${set}.json`),
      JSON.stringify(all),
    );
    writeFileSync(join(dir, "input", `excluded-${set}.json`), "[]");
    for (const version of Object.keys(PRODUCTS))
      for (let chunk = 0; chunk < 8; chunk++) {
        const from = chunk * 8,
          to = Math.min(from + 8, 59),
          cards = all.slice(from, to);
        const file = join(dir, `${set}-${version}-c${chunk}.jsonl`);
        first ??= file;
        const records = [
          {
            type: "meta",
            version,
            set,
            settings: SETTINGS_SETS[set],
            trials: 3,
            cards: cards.map((card) => card.id),
            only: `#${from}-${to}`,
            build,
            hello: {
              vscode: version,
              vim: { version: "1.32.4" },
              whichkey: { version: "0.11.4" },
              adapter: null,
            },
            started: "2026-10-28T00:00:00.000Z",
          },
        ];
        for (const card of cards)
          for (const row of card.rows)
            for (let trial = 0; trial < 3; trial++) {
              const common = {
                type: "trial",
                card: card.id,
                key: row.key,
                trial,
                ok: true,
                diff: [],
              };
              if (row.negative) {
                negativeFile ??= file;
                records.push({
                  ...common,
                  kind: "negative",
                  token: row.negative.token,
                  tries: row.negative.tries.map((chord) => ({
                    chord,
                    received: [],
                    delivered: false,
                  })),
                });
              } else {
                const beforeRegisters = {
                  "%": { mode: "character", lines: ["a.txt"] },
                  "#": { mode: "character", lines: ["b.txt"] },
                  ":": { mode: "character", lines: ["set scroll=0"] },
                };
                const registers = row.expect.registers ?? {};
                const got = {
                  text: textOf(row.expect),
                  cursor: row.expect.cursor,
                  mode: row.expect.mode,
                  registers,
                  ...(row.expect.quickPick
                    ? { quickPick: { visible: true, ...row.expect.quickPick } }
                    : {}),
                };
                records.push({
                  ...common,
                  typed: [...card.keys, row.sample ?? row.key],
                  got,
                  want: got,
                  beforeRegisters,
                  afterRegisters: { ...beforeRegisters, ...registers },
                });
              }
            }
        records.push({ type: "end", finished: "2026-10-28T01:00:00.000Z" });
        write(file, records);
      }
  }
});
after(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("the entire synthetic 42,450-trial matrix passes independent verification", () => {
  const result = verifyMatrix(dir, input, head);
  assert.equal(result.verdict, "pass", JSON.stringify(result));
  assert.equal(result.chunks, 32);
  assert.equal(result.negatives, 660);
});
function corrupt(title, mutate, pattern) {
  test(title, () => {
    const saved = readFileSync(first);
    try {
      const records = read(first);
      mutate(records);
      write(first, records);
      const result = verifyMatrix(dir, input, head);
      assert.equal(result.verdict, "not pass");
      assert.match(result.problems.join("\n"), pattern);
    } finally {
      writeFileSync(first, saved);
    }
  });
}
corrupt(
  "a forged ok cannot hide an actual text mismatch",
  (records) => {
    records[1].got.text = ["wrong"];
  },
  /independent state comparison/,
);
corrupt(
  "legacy empty Ex keys cannot prove register preservation",
  (records) => {
    for (const field of ["beforeRegisters", "afterRegisters"])
      records[1][field][":"] = { mode: "character", keys: "" };
  },
  /actual Ex command text/,
);
corrupt(
  "missing before snapshots cannot fall back to partial got registers",
  (records) => {
    delete records[1].beforeRegisters;
  },
  /incomplete beforeRegisters/,
);
corrupt(
  "duplicating one trial cannot replace a missing repetition",
  (records) => {
    records[2] = records[1];
  },
  /duplicate trial/,
);
corrupt(
  "a different frozen SHA cannot pass",
  (records) => {
    records[0].build.head = "2".repeat(40);
  },
  /requested clean frozen build/,
);
corrupt(
  "the public tag is not the installed VS Code product",
  (records) => {
    records[0].build.external.code["1.134.0"].commit =
      "474a349ad5b745e512ef86b864d1c74f7264dd7a";
  },
  /unpinned VS Code product/,
);
corrupt(
  "a completed smoke selection cannot be relabeled a full chunk",
  (records) => {
    records[0].only = "#0-1";
  },
  /card slice differs/,
);
corrupt(
  "the wrong settings or engine version cannot pass",
  (records) => {
    records[0].settings = SETTINGS_SETS.extensions;
    records[0].hello.vim.version = "1.0.0";
  },
  /condition, settings/,
);
corrupt(
  "a retained run error makes the final matrix fail",
  (records) => {
    records.splice(-1, 0, { type: "error", error: "synthetic" });
  },
  /unexpected error/,
);
corrupt(
  "a missing final marker cannot pass",
  (records) => {
    records.pop();
  },
  /one final end marker/,
);
test("stale or focused input is rejected even when the raw rows are complete", () => {
  const file = join(dir, "input", "correctness-defaults.json"),
    saved = readFileSync(file);
  try {
    writeFileSync(file, JSON.stringify(input.defaults.slice(0, 1)));
    assert.match(
      verifyMatrix(dir, input, head).problems.join("\n"),
      /recorded input differs/,
    );
  } finally {
    writeFileSync(file, saved);
  }
});
test("an incomplete retained JSONL file cannot be ignored", () => {
  const file = join(dir, "defaults-1.134.0-c0.incomplete-synthetic.jsonl");
  try {
    writeFileSync(file, "{}\n");
    assert.match(
      verifyMatrix(dir, input, head).problems.join("\n"),
      /exactly the 32/,
    );
  } finally {
    rmSync(file);
  }
});
test("negative rows must try every authored chord and record no delivered token", () => {
  const saved = readFileSync(negativeFile);
  try {
    const records = read(negativeFile),
      negative = records.find((record) => record.kind === "negative");
    assert.ok(negative);
    negative.tries.pop();
    write(negativeFile, records);
    assert.match(
      verifyMatrix(dir, input, head).problems.join("\n"),
      /chord evidence incomplete/,
    );
  } finally {
    writeFileSync(negativeFile, saved);
  }
});
test("a false delivered flag cannot hide the token in received keys", () => {
  const saved = readFileSync(negativeFile);
  try {
    const records = read(negativeFile),
      negative = records.find((record) => record.kind === "negative");
    negative.tries[0].received = [negative.token];
    write(negativeFile, records);
    assert.match(
      verifyMatrix(dir, input, head).problems.join("\n"),
      /negative token delivery/,
    );
  } finally {
    writeFileSync(negativeFile, saved);
  }
});
