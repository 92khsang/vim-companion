import assert from "node:assert/strict";
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
import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { auditRendered } from "./cards-completeness.mjs";
import { prepareInstance, REPO, SPIKE_EXTENSIONS } from "./lib.mjs";
import { configOf, holds } from "../check1/lib.mjs";

function fixture() {
  const reference = {
    set: "defaults",
    settings: {},
    cards: [
      {
        id: "insert []",
        mode: "insert",
        bufferedBefore: [],
        actionKeys: [],
        resolvedState: { pending: [], operator: null },
        actionRows: { x: [{ keys: ["x"] }], j: [{ keys: ["j"] }] },
      },
    ],
  };
  const authored = [
    {
      id: "insert []",
      rows: [
        { key: "x", label: "Insert x" },
        { key: "j", label: "Insert j" },
      ],
    },
  ];
  const rendered = [
    {
      id: "insert []",
      headers: ["Key", "Does", "Unsupported"],
      rows: authored[0].rows.map((row) => ({ ...row, unsupported: "" })),
    },
  ];
  return { reference, authored, rendered };
}
test("rendered keys and cells match both the engine and the authored card", () => {
  const { reference, authored, rendered } = fixture();
  assert.equal(auditRendered(rendered, authored, reference).verdict, "pass");
});
for (const [name, corrupt] of [
  ["extra card", (r) => r.push({ ...r[0], id: "unexpected" })],
  ["duplicate card", (r) => r.push(r[0])],
  ["missing card", (r) => r.pop()],
  ["duplicate row", (r) => r[0].rows.push(r[0].rows[0])],
  ["missing row", (r) => r[0].rows.pop()],
  [
    "stale label",
    (r) => {
      r[0].rows[0].label = "Old description";
    },
  ],
  [
    "missing unsupported explanation",
    (r, a) => {
      a[0].rows[0].unsupported = "Not available on Linux";
    },
  ],
  [
    "wrong column headers",
    (r) => {
      r[0].headers = ["Key", "Does"];
    },
  ],
])
  test(`${name} cannot pass completeness`, () => {
    const { reference, authored, rendered } = fixture();
    corrupt(rendered, authored);
    assert.equal(
      auditRendered(rendered, authored, reference).verdict,
      "not pass",
    );
  });
test("an authored omission does not redefine the engine reference", () => {
  const { reference, authored, rendered } = fixture();
  authored[0].rows.pop();
  rendered[0].rows.pop();
  const result = auditRendered(rendered, authored, reference);
  assert.equal(result.verdict, "not pass");
  assert.match(result.problems.join("\n"), /input rows differ/);
});
test("cardsFile changes only the prepared sandbox extension, never frozen source", () => {
  const dir = mkdtempSync(join(tmpdir(), "s2-cards-instance-test-"));
  const oldRoot = process.env.S2_ROOT;
  const source = join(SPIKE_EXTENSIONS, "s2-cards/cards.json"),
    original = readFileSync(source);
  try {
    process.env.S2_ROOT = dir;
    mkdirSync(join(dir, "ext/base"), { recursive: true });
    const cardsFile = join(dir, "cards.json");
    writeFileSync(cardsFile, '[{"id":"synthetic sandbox card","rows":[]}]\n');
    const inst = prepareInstance({
      name: "cards-test",
      spikeExtensions: ["s2-cards"],
      cardsFile,
    });
    assert.deepEqual(
      readFileSync(
        join(inst, "ext/vim-companion-spike.s2-cards-0.0.1/cards.json"),
      ),
      readFileSync(cardsFile),
    );
    assert.deepEqual(readFileSync(source), original);
    assert.throws(
      () =>
        prepareInstance({
          name: "wrong-extension",
          spikeExtensions: ["s2-probe"],
          cardsFile,
        }),
      /requires the s2-cards/,
    );
  } finally {
    if (oldRoot === undefined) delete process.env.S2_ROOT;
    else process.env.S2_ROOT = oldRoot;
    rmSync(dir, { recursive: true, force: true });
  }
});
test("all four full authored catalogs match the pinned engine reference keys", () => {
  const dir = mkdtempSync(join(tmpdir(), "s2-complete-catalog-test-"));
  try {
    execFileSync(
      process.execPath,
      [join(REPO, "spike/s2/check1/build.mjs"), dir],
      { stdio: "pipe" },
    );
    for (const version of ["1.134.0", "1.141.0"])
      for (const set of ["defaults", "extensions"]) {
        const authored = JSON.parse(
          readFileSync(join(dir, `cards-${set}.json`), "utf8"),
        );
        const reference = JSON.parse(
          gunzipSync(
            readFileSync(
              join(
                REPO,
                `spike/s2/data/cards-reference/cards3-${set}-${version}.json.gz`,
              ),
            ),
          ),
        );
        const rendered = authored.map((card) => ({
          id: card.id,
          headers: ["Key", "Does", "Unsupported"],
          rows: card.rows
            .filter((row) => holds(row.when, configOf(set)))
            .map((row) => ({
              key: row.key,
              label: row.label,
              unsupported: row.unsupported ?? "",
            })),
        }));
        const result = auditRendered(rendered, authored, reference);
        assert.equal(result.summary.cards, 59);
        assert.equal(result.verdict, "pass", JSON.stringify(result.problems));
      }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
