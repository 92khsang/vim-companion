// Final check (1) acceptance, independently of the human-readable summary. Run from the
// measured frozen checkout: node spike/s2/batch/check1-verify.mjs <data dir> <full HEAD SHA>
// Rebuilds the strict input, then checks the full catalog, every chunk and every trial. A focused
// source matrix is not a full pass, even if every trial says ok. Original files are never changed.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual as same } from "node:util";
import { buildInfo, REPO } from "../harness/lib.mjs";
import { SETTINGS_SETS } from "../harness/cards-extract.mjs";
import { configOf, holds, SETS } from "../check1/lib.mjs";
import { compare } from "../check1/deviations.mjs";

export const PRODUCTS = {
  "1.134.0": "110a328ea54b42367b803ec53ee0bf52ef26b419",
  "1.141.0": "2a59476c9bfcb90b3ddc372c36762471b7dfad1c",
};
const VERSIONS = Object.keys(PRODUCTS);
const ROWS = { defaults: 3442, extensions: 3633 };
const NEGATIVES = { defaults: 53, extensions: 57 };
const CHUNK = 8;
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isLines = (value) =>
  Array.isArray(value) && value.every((line) => typeof line === "string");
const rowId = (card, key) => JSON.stringify([card, key]);

/** Strict builder output is the authority for expectations; the catalog independently fixes scope. */
export function buildFullInput() {
  const dir = mkdtempSync(join(tmpdir(), "s2-final-input-"));
  try {
    execFileSync(
      process.execPath,
      [join(REPO, "spike/s2/check1/build.mjs"), dir],
      { stdio: "pipe" },
    );
    const catalog = json(join(REPO, "spike/s2/cards/cards.json"));
    if (
      catalog.length !== 59 ||
      new Set(catalog.map((card) => card.id)).size !== 59
    )
      throw new Error("the final contract requires 59 unique catalog cards");
    const input = {};
    for (const set of SETS) {
      const cards = json(join(dir, `correctness-${set}.json`));
      const scope = (cards) =>
        cards.map((card) => [card.id, card.rows.map((row) => row.key)]);
      const wanted = catalog.map((card) => ({
        ...card,
        rows: card.rows.filter((row) => holds(row.when, configOf(set))),
      }));
      if (!same(scope(cards), scope(wanted)))
        throw new Error(`${set}: builder does not cover the canonical catalog`);
      const rows = cards.flatMap((card) => card.rows);
      if (
        rows.length !== ROWS[set] ||
        rows.filter((row) => row.negative).length !== NEGATIVES[set]
      )
        throw new Error(`${set}: unexpected full-matrix row count`);
      if (json(join(dir, `excluded-${set}.json`)).length)
        throw new Error(`${set}: excluded rows`);
      input[set] = cards;
    }
    return input;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function registerValue(value, name) {
  if (value === null) return true;
  if (!isObject(value)) return false;
  if (name === ":")
    return (
      value.mode === "character" && isLines(value.lines) && !("keys" in value)
    );
  if (Array.isArray(value.cursors))
    return value.cursors.every((v) => registerValue(v, name));
  return (
    ["character", "line", "block"].includes(value.mode) &&
    (isLines(value.lines) || typeof value.keys === "string")
  );
}

/** The CLI supplies only freshly rebuilt canonical input; exporting permits synthetic regression tests. */
export function verifyMatrix(dir, input, head) {
  const problems = [];
  let problemCount = 0,
    trials = 0,
    negatives = 0,
    build = null;
  const fail = (message) => {
    problemCount++;
    if (problems.length < 100) problems.push(message);
  };
  if (!/^[0-9a-f]{40}$/.test(head ?? ""))
    fail("expected a full frozen HEAD SHA");
  const names = VERSIONS.flatMap((version) =>
    SETS.flatMap((set) =>
      Array.from(
        { length: 8 },
        (_, chunk) => `${set}-${version}-c${chunk}.jsonl`,
      ),
    ),
  );
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".jsonl"))
    .sort();
  if (!same(files, [...names].sort()))
    fail(
      "expected exactly the 32 final chunk files; no extra or incomplete JSONL files",
    );
  for (const set of SETS) {
    const actual = json(join(dir, "input", `correctness-${set}.json`));
    if (!same(actual, input[set]))
      fail(
        `${set}: recorded input differs from the current strict builder output`,
      );
    if (!same(json(join(dir, "input", `excluded-${set}.json`)), []))
      fail(`${set}: excluded rows`);
    if (
      input[set].length !== 59 ||
      input[set].reduce((n, card) => n + card.rows.length, 0) !== ROWS[set]
    )
      fail(`${set}: input is not the full 59-card contract`);
    const keys = input[set].flatMap((card) =>
      card.rows.map((row) => rowId(card.id, row.key)),
    );
    if (new Set(keys).size !== ROWS[set])
      fail(`${set}: missing or duplicate full-catalog row identities`);
  }
  for (const version of VERSIONS)
    for (const set of SETS)
      for (let chunk = 0; chunk < 8; chunk++) {
        const file = `${set}-${version}-c${chunk}.jsonl`;
        if (!files.includes(file)) {
          fail(`${file}: missing`);
          continue;
        }
        let records;
        try {
          records = readFileSync(join(dir, file), "utf8")
            .split("\n")
            .filter(Boolean)
            .map(JSON.parse);
        } catch (error) {
          fail(`${file}: unreadable JSONL: ${error.message}`);
          continue;
        }
        const metas = records.filter((record) => record.type === "meta");
        if (metas.length !== 1 || records[0]?.type !== "meta") {
          fail(`${file}: expected one initial metadata record`);
          continue;
        }
        if (
          records.filter((record) => record.type === "end").length !== 1 ||
          records.at(-1)?.type !== "end"
        )
          fail(`${file}: expected one final end marker`);
        const meta = metas[0],
          from = chunk * CHUNK,
          to = Math.min(from + CHUNK, 59);
        const cards = input[set].slice(from, to);
        if (
          meta.set !== set ||
          meta.version !== version ||
          meta.trials !== 3 ||
          meta.only !== `#${from}-${to}` ||
          !same(
            meta.cards,
            cards.map((card) => card.id),
          ) ||
          !same(meta.settings, SETTINGS_SETS[set])
        )
          fail(
            `${file}: condition, settings, trials or card slice differs from the final contract`,
          );
        if (
          meta.hello?.vscode !== version ||
          meta.hello?.vim?.version !== "1.32.4" ||
          meta.hello?.whichkey?.version !== "0.11.4" ||
          meta.hello?.adapter !== null
        )
          fail(`${file}: unexpected installed IDE, engine or adapter`);
        const b = meta.build;
        if (!b || b.head !== head || !same(b.dirty, []))
          fail(`${file}: not the requested clean frozen build`);
        else {
          const id = createHash("sha256")
            .update(
              JSON.stringify({
                head: b.head,
                dirty: "",
                sha256: b.sha256,
                external: b.external,
              }),
            )
            .digest("hex")
            .slice(0, 16);
          if (b.id !== id) fail(`${file}: invalid build fingerprint`);
          for (const [v, commit] of Object.entries(PRODUCTS))
            if (!same(b.external?.code?.[v], { version: v, commit }))
              fail(`${file}: unpinned VS Code product ${v}`);
          if (
            !same(b.external?.extBaseFolders, [
              "vscodevim.vim-1.32.4",
              "vspacecode.whichkey-0.11.4",
            ]) ||
            !/^[0-9a-f]{64}$/.test(b.external?.extBase ?? "") ||
            ![
              "adapter",
              "probe",
              "script",
              "harness",
              "remaps",
              "whichkey",
            ].every((key) => /^[0-9a-f]{64}$/.test(b.sha256?.[key] ?? ""))
          )
            fail(`${file}: missing pinned extension or source fingerprints`);
          if (build && !same(build, b)) fail(`${file}: mixed builds`);
          build ??= b;
        }
        if (
          !Number.isFinite(Date.parse(meta.started)) ||
          !Number.isFinite(Date.parse(records.at(-1)?.finished)) ||
          Date.parse(records.at(-1)?.finished) < Date.parse(meta.started)
        )
          fail(`${file}: missing or reversed run timestamps`);
        const expected = new Map(
          cards.flatMap((card) =>
            card.rows.map((row) => [rowId(card.id, row.key), { card, row }]),
          ),
        );
        const seen = new Set();
        for (const record of records.slice(1, -1)) {
          if (record.type !== "trial") {
            fail(`${file}: unexpected ${record.type} record`);
            continue;
          }
          trials++;
          const entry = expected.get(rowId(record.card, record.key));
          const id = JSON.stringify([record.card, record.key, record.trial]);
          const label = `${file}: ${id}`;
          if (
            !entry ||
            !Number.isInteger(record.trial) ||
            record.trial < 0 ||
            record.trial > 2
          ) {
            fail(`${label}: trial outside the expected chunk`);
            continue;
          }
          if (seen.has(id)) fail(`${label}: duplicate trial`);
          seen.add(id);
          if (record.ok !== true || !same(record.diff, []))
            fail(`${label}: reported failure or malformed result`);
          const { card, row } = entry;
          if (row.negative) {
            negatives++;
            if (
              record.kind !== "negative" ||
              record.token !== row.negative.token ||
              !Array.isArray(record.tries) ||
              !same(
                record.tries.map((attempt) => attempt.chord),
                row.negative.tries,
              ) ||
              !record.tries.every(
                (attempt) =>
                  attempt.delivered === false &&
                  Array.isArray(attempt.received) &&
                  !attempt.received.includes(row.negative.token),
              )
            )
              fail(
                `${label}: negative token delivery or chord evidence incomplete`,
              );
            continue;
          }
          if (
            record.kind ||
            !same(record.typed, [...card.keys, row.sample ?? row.key])
          )
            fail(`${label}: positive trial type or typed sequence differs`);
          let complete = true;
          for (const field of ["beforeRegisters", "afterRegisters"]) {
            const registers = record[field];
            if (
              !isObject(registers) ||
              !("%" in registers) ||
              !("#" in registers) ||
              !Object.entries(registers).every(([name, value]) =>
                registerValue(value, name),
              )
            ) {
              fail(
                `${label}: incomplete ${field}, including actual Ex command text`,
              );
              complete = false;
            }
          }
          if (
            !isObject(record.got) ||
            !isObject(record.got?.registers) ||
            !isObject(record.want?.registers)
          ) {
            fail(`${label}: missing observed or expected state`);
            continue;
          }
          if (complete && compare(row.expect, record) !== "match")
            fail(`${label}: independent state comparison did not match`);
          const quickPick = row.expect.quickPick
            ? { visible: true, ...row.expect.quickPick }
            : undefined;
          if (!same(record.got.quickPick, quickPick))
            fail(`${label}: quick-pick state differs`);
        }
        if (
          seen.size !== cards.reduce((n, card) => n + card.rows.length * 3, 0)
        )
          fail(`${file}: missing expected trial identities`);
      }
  if (trials !== 42450 || negatives !== 660)
    fail(`wrong final totals: ${trials} trials, ${negatives} negative trials`);
  return {
    verdict: problemCount ? "not pass" : "pass",
    head,
    build: build?.id ?? null,
    chunks: files.length,
    trials,
    negatives,
    problemCount,
    problems,
  };
}

export function verifyCheck1(dir, head) {
  const actualHead = execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (actualHead !== head)
    throw new Error("run the verifier from the measured frozen HEAD");
  const dirty = execFileSync(
    "git",
    [
      "-C",
      REPO,
      "status",
      "--porcelain",
      "--",
      "spike/s2",
      "spec",
      ":!spike/s2/data",
    ],
    { encoding: "utf8" },
  ).trim();
  if (dirty) throw new Error("the verifier checkout is not clean");
  const meta = JSON.parse(
    readFileSync(join(dir, "defaults-1.134.0-c0.jsonl"), "utf8").split("\n")[0],
  );
  if (!same(meta.build?.sha256, buildInfo().sha256))
    throw new Error(
      "recorded source fingerprints differ from this frozen checkout",
    );
  return verifyMatrix(dir, buildFullInput(), head);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = verifyCheck1(...process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
    if (result.verdict !== "pass") process.exitCode = 1;
  } catch (error) {
    console.log(
      JSON.stringify({ verdict: "not pass", error: error.message }, null, 2),
    );
    process.exitCode = 1;
  }
}
