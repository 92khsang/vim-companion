// Recheck the completed rendered smoke against the frozen source and state-preparation contract.
// Usage: FROZEN_CHECKOUT=<measured checkout> node audit-smoke.mjs <smoke directory>
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [dir] = process.argv.slice(2);
const repo = process.env.FROZEN_CHECKOUT;
const { buildInfo, START } = await import(pathToFileURL(join(repo, "spike/s2/harness/lib.mjs")));
const { SETTINGS_SETS } = await import(pathToFileURL(join(repo, "spike/s2/harness/cards-extract.mjs")));
const { needsLineUndoPreparation, needsScrollPreparation } = await import(pathToFileURL(join(repo, "spike/s2/harness/trial-preparation.mjs")));
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const basic = JSON.parse(execFileSync(process.execPath,
  [join(import.meta.dirname, "render-smoke.mjs"), "verify", dir], { encoding: "utf8" }));
assert.deepEqual(basic, read(join(dir, "verification.json")));
const build = buildInfo();
assert.equal(build.head, basic.head);
assert.equal(build.id, basic.build);
assert.deepEqual(build.dirty, []);
const conditions = [];
for (const version of ["1.141.0", "1.134.0"])
  for (const set of ["defaults", "extensions"]) {
    const cards = read(join(dir, `input-${set}.json`));
    const full = read(join(dir, "..", "check2", "input", `correctness-${set}.json`));
    const selected = new Map(cards.map((card) => [card.id, new Set(card.rows.map((row) => row.key))]));
    assert.deepEqual(cards, full.filter((card) => selected.has(card.id)).map((card) => ({
      ...card, rows: card.rows.filter((row) => selected.get(card.id).has(row.key)),
    })));
    const byKey = new Map(cards.flatMap((card) => card.rows.map((row) => [JSON.stringify([card.id, row.key]), { card, row }])));
    const records = readFileSync(join(dir, `${set}-${version}.jsonl`), "utf8").trim().split("\n").map(JSON.parse);
    const meta = records[0];
    assert.deepEqual(meta.build, build);
    assert.deepEqual(meta.settings, SETTINGS_SETS[set]);
    assert.equal(meta.hello.vscode, version);
    assert.equal(meta.hello.vim.version, "1.32.4");
    assert.equal(meta.hello.whichkey.version, "0.11.4");
    assert.equal(meta.hello.adapter, null);
    const counts = { historyPrepared: 0, scrollPrepared: 0, windowPrepared: 0, exTextSnapshots: 0 };
    for (const trial of records.filter((record) => record.type === "trial")) {
      const { card, row } = byKey.get(JSON.stringify([trial.card, trial.key]));
      assert.deepEqual(trial.typed, [...card.keys, row.sample ?? row.key]);
      assert.equal(Boolean(trial.historyPreparation), needsLineUndoPreparation(card, row));
      assert.equal(Boolean(trial.scrollPreparation), needsScrollPreparation(card, row));
      for (const field of ["beforeRegisters", "afterRegisters"]) {
        assert.ok(trial[field] && "%" in trial[field] && "#" in trial[field]);
        const ex = trial[field][":"];
        if (ex) {
          assert.equal(ex.mode, "character");
          assert.ok(Array.isArray(ex.lines) && ex.lines.every((line) => typeof line === "string"));
          assert.ok(!("keys" in ex));
          counts.exTextSnapshots++;
        }
      }
      if (needsLineUndoPreparation(card, row)) {
        assert.equal(trial.historyPreparation.registersPreserved, true);
        assert.deepEqual(trial.historyPreparation.prepared, {
          handler: true, depth: 0, index: -1, totalChanges: 0, currentChanges: 0,
          pendingContentChanges: 0, currentDocumentMatches: true,
        });
        counts.historyPrepared++;
      }
      if (needsScrollPreparation(card, row)) {
        assert.equal(trial.scrollPreparation.scroll, 0);
        assert.equal(trial.beforeViewport.scroll, 0);
        assert.deepEqual(trial.beforeViewport.visibleRanges, [[0, 0, 4, 0]]);
        counts.scrollPrepared++;
      }
      if (card.id === 'normal ["<C-w>"]' && row.key === "l") {
        const prepared = trial.windowPreparation;
        assert.equal(prepared.file, "b.txt");
        assert.equal(prepared.viewColumn, 2);
        assert.equal(prepared.mode, "normal");
        assert.deepEqual(prepared.text, START.lines);
        assert.deepEqual(prepared.selections, [[1, 13, 1, 13]]);
        assert.equal(trial.activeFile, "b.txt");
        assert.equal(trial.activeViewColumn, 2);
        counts.windowPrepared++;
      }
    }
    assert.equal(counts.historyPrepared, 2);
    assert.equal(counts.scrollPrepared, 1);
    assert.equal(counts.windowPrepared, 1);
    conditions.push({ version, set, trials: 7, ...counts });
  }
console.log(JSON.stringify({ verdict: "pass", head: basic.head, build: basic.build,
  trials: 28, conditions }, null, 2));
