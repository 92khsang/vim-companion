// Lists the rows of the check (1) input files per settings set as TSV (set, card, key, source,
// reason or pending), optionally only those whose reason starts with a prefix, and prints the
// counts per source and reason class to stderr.
// Usage: node spike/s2/check1/rows.mjs [reason prefix, e.g. outside] > rows.tsv
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../harness/lib.mjs";
import { cardFile } from "./lib.mjs";

const prefix = process.argv[2] ?? "";
const S2 = join(REPO, "spike/s2");
const cards = JSON.parse(readFileSync(join(S2, "cards/cards.json"), "utf8"));
const counts = {};
const lines = [];
for (const card of cards) {
  const input = JSON.parse(
    readFileSync(join(S2, "check1/cards", cardFile(card)), "utf8"),
  );
  for (const r of input.rows)
    for (const s of r.sets) {
      const x = { ...r, ...(r.bySet?.[s] ?? {}) };
      const why = x.pending ? `pending: ${x.pending}` : (x.reason ?? "");
      const cls = x.pending
        ? "vim-oracle pending " + x.pending.split(":")[0]
        : x.source === "hand"
          ? `hand ${why.split(":")[0]}${/^(outside|state)/.test(why) ? ": " + why.split(":")[1].split(";")[0].trim() : ""}`
          : "vim-oracle";
      counts[s] ??= {};
      counts[s][cls] = (counts[s][cls] ?? 0) + 1;
      if (
        why.startsWith(prefix) &&
        (prefix || x.source === "hand" || x.pending)
      )
        lines.push(
          [s, card.id, JSON.stringify(r.key), x.source, why].join("\t"),
        );
    }
}
process.stdout.write(lines.join("\n") + "\n");
console.error(JSON.stringify(counts, null, 1));
