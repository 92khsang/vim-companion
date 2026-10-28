// Pure audit of the actual webview cells against authored labels and the engine key reference.
import { isDeepStrictEqual as same } from "node:util";
import { configOf, holds } from "../check1/lib.mjs";
import { rowsOf } from "./cards-count.mjs";

export const RENDERED_CARDS_JS = `(doc) => [...doc.querySelectorAll('section.card')].map((s) => ({
  id: s.dataset.card,
  headers: [...s.querySelectorAll('thead th[scope=col]')].map((th) => th.textContent),
  rows: [...s.querySelectorAll('tbody tr')].map((tr) => ({
    key: tr.querySelector('th[scope=row]')?.textContent,
    label: tr.querySelectorAll('td')[0]?.textContent,
    unsupported: tr.querySelectorAll('td')[1]?.textContent
  }))
}))`;

export function auditRendered(rendered, authored, reference) {
  const problems = [],
    cards = [];
  const config = configOf(reference.set);
  const ids = (items) => items.map((card) => card.id);
  for (const [name, items] of [
    ["reference", reference.cards],
    ["input", authored],
    ["rendered", rendered],
  ])
    if (new Set(ids(items)).size !== items.length)
      problems.push(`${name}: duplicate card IDs`);
  if (!same(ids(authored), ids(reference.cards)))
    problems.push("input card IDs differ from the engine reference");
  if (!same(ids(rendered), ids(authored)))
    problems.push("rendered card IDs or order differ from the input");
  const byId = new Map(rendered.map((card) => [card.id, card]));
  const authoredById = new Map(authored.map((card) => [card.id, card]));
  let missing = 0,
    extra = 0,
    cellDifferences = 0;
  for (const card of reference.cards) {
    const want = new Set(rowsOf(card, reference.settings).keys());
    const input =
      authoredById
        .get(card.id)
        ?.rows.filter((row) => holds(row.when, config)) ?? [];
    const r = byId.get(card.id);
    const rows = r?.rows ?? [],
      got = new Set(rows.map((row) => row.key));
    const miss = [...want].filter((key) => !got.has(key));
    const ext = [...got].filter((key) => !want.has(key));
    const duplicates = rows.length - got.size;
    const inputKeys = input.map((row) => row.key);
    if (
      new Set(inputKeys).size !== input.length ||
      !same([...new Set(inputKeys)].sort(), [...want].sort())
    )
      problems.push(`${card.id}: input rows differ from the engine reference`);
    const wantedCells = input.map((row) => ({
      key: row.key,
      label: row.label ?? "",
      unsupported: row.unsupported ?? "",
    }));
    const cellsMatch = same(rows, wantedCells);
    if (!cellsMatch) cellDifferences++;
    if (!same(r?.headers, ["Key", "Does", "Unsupported"]))
      problems.push(`${card.id}: missing or incorrect column headers`);
    missing += miss.length;
    extra += ext.length + duplicates;
    cards.push({
      id: card.id,
      rendered: Boolean(r),
      want: want.size,
      got: got.size,
      missing: miss,
      extra: ext,
      duplicates,
      cellsMatch,
      headers: r?.headers,
    });
  }
  const summary = {
    cards: reference.cards.length,
    renderedCards: rendered.length,
    missing,
    extra,
    cellDifferences,
  };
  const pass =
    !problems.length &&
    !missing &&
    !extra &&
    !cellDifferences &&
    cards.every((card) => card.rendered);
  return { verdict: pass ? "pass" : "not pass", cards, summary, problems };
}
