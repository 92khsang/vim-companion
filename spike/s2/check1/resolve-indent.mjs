// Resolves the rows of the check (1) input that wait on the indentation (pending "indentation"):
// VS Code detects "Spaces: 2" for the fixture buffer (spike/s2/data/check1/observe-1.141.0.json,
// editor.detectIndentation is not pinned in the sandbox), so the expectation is the answer of the
// oracle with expect-sw2.vimrc (shiftwidth=2), which fill.mjs stored under `variants`.
// Usage: node spike/s2/check1/resolve-indent.mjs
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../harness/lib.mjs";

const IN = join(REPO, "spike/s2/check1/cards");
const NOTE =
  "VS Code gives the fixture buffer Spaces: 2 (editor.detectIndentation, not pinned in the sandbox), so the answer of expect-sw2.vimrc";
let resolved = 0;
const fix = (v) => {
  if (!v?.pending?.startsWith("indentation")) return v;
  const { pending: _p, variants, ...rest } = v;
  resolved += 1;
  return {
    ...rest,
    expect: variants["expect-sw2.vimrc"],
    oracle: "expect-sw2.vimrc",
    indentation: NOTE,
  };
};
for (const f of readdirSync(IN).sort()) {
  const file = join(IN, f);
  const card = JSON.parse(readFileSync(file, "utf8"));
  const before = JSON.stringify(card);
  card.rows = card.rows.map((row) => {
    let r = fix(row);
    if (r.bySet)
      r = {
        ...r,
        bySet: Object.fromEntries(
          Object.entries(r.bySet).map(([s, v]) => [s, fix(v)]),
        ),
      };
    return r;
  });
  if (JSON.stringify(card) !== before)
    writeFileSync(file, JSON.stringify(card, null, 2) + "\n");
}
console.log(JSON.stringify({ resolved }));
