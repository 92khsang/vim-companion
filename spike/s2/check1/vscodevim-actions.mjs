// A static list of VSCodeVim's registered actions from a source checkout (read only; nothing of it
// runs): for each class after `@RegisterAction` in src/**/*.ts, its file, line, modes and key
// sequences, taking `modes` and `keys` from the nearest class up the `extends` chain that sets
// them. Key arrays are read by a small literal parser (strings, identifiers such as
// SpecialKeys.X, nested arrays); anything else is reported as unparsed.
// Usage: node spike/s2/check1/vscodevim-actions.mjs <VSCodeVim checkout> <out.json>
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const [root, outFile] = process.argv.slice(2);
const files = [];
(function walk(dir) {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) walk(p);
    else if (d.name.endsWith(".ts") && !d.name.endsWith(".d.ts")) files.push(p);
  }
})(join(root, "src"));

/** The bracketed text that starts at text[i] === "[" (strings skipped). */
function bracket(text, i) {
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === "'" || c === '"' || c === "`") {
      for (j++; j < text.length && text[j] !== c; j++)
        if (text[j] === "\\") j++;
      continue;
    }
    if (c === "[") depth++;
    if (c === "]" && --depth === 0) return text.slice(i, j + 1);
  }
  return null;
}
const ESC = { n: "\n", t: "\t", "\\": "\\", "'": "'", '"': '"', "`": "`" };
/** Parses a literal array of strings, identifiers and arrays; throws on anything else. */
function literal(src) {
  let i = 0;
  const ws = () => {
    for (;;) {
      while (i < src.length && /[\s,]/.test(src[i])) i++;
      if (src.startsWith("//", i))
        while (i < src.length && src[i] !== "\n") i++;
      else if (src.startsWith("/*", i)) i = src.indexOf("*/", i) + 2;
      else return;
    }
  };
  function value() {
    ws();
    const c = src[i];
    if (c === "[") {
      i++;
      const out = [];
      for (ws(); src[i] !== "]"; ws()) {
        if (i >= src.length) throw new Error("unterminated array");
        out.push(value());
      }
      i++;
      return out;
    }
    if (c === "'" || c === '"' || c === "`") {
      let s = "";
      for (i++; src[i] !== c; i++) {
        if (i >= src.length) throw new Error("unterminated string");
        if (src[i] === "\\") s += ESC[src[++i]] ?? src[i];
        else s += src[i];
      }
      i++;
      return s;
    }
    const m = /^[A-Za-z_$][\w$.]*/.exec(src.slice(i));
    if (m) {
      i += m[0].length;
      return `<${m[0]}>`;
    }
    throw new Error(`unexpected ${JSON.stringify(src.slice(i, i + 20))}`);
  }
  const v = value();
  ws();
  if (i < src.length && src.slice(i).trim()) throw new Error("trailing text");
  return v;
}

// Key constants such as SpecialKeys.ExtensionDisable are string enum members.
const SPECIAL = Object.fromEntries(
  [
    ...readFileSync(join(root, "src/util/specialKeys.ts"), "utf8").matchAll(
      /(\w+)\s*=\s*'([^']*)'/g,
    ),
  ].map(([, k, v]) => [`<SpecialKeys.${k}>`, v]),
);
const resolveIds = (v) =>
  Array.isArray(v) ? v.map(resolveIds) : (SPECIAL[v] ?? v);
const classes = new Map();
for (const f of files) {
  const text = readFileSync(f, "utf8");
  const re =
    /(@RegisterAction\s+)?(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:<[^>]*>)?\s+extends\s+([\w.]+)/g;
  const found = [...text.matchAll(re)];
  found.forEach((m, k) => {
    const end = k + 1 < found.length ? found[k + 1].index : text.length;
    const body = text.slice(m.index, end);
    const field = (name) => {
      const fm = new RegExp(
        `\\n\\s*(?:public\\s+|protected\\s+|override\\s+|readonly\\s+)*${name}\\s*(?::[^=\\n]+)?=\\s*\\[`,
      ).exec(body);
      if (!fm) return undefined;
      const src = bracket(body, fm.index + fm[0].length - 1);
      try {
        return { value: resolveIds(literal(src)) };
      } catch (e) {
        return { unparsed: src.replace(/\s+/g, " ").slice(0, 200) };
      }
    };
    classes.set(m[2], {
      name: m[2],
      registered: Boolean(m[1]),
      parent: m[3],
      file: relative(root, f),
      line: text.slice(0, m.index + (m[1]?.length ?? 0)).split("\n").length,
      keys: field("keys"),
      modes: field("modes"),
    });
  });
}
const inherit = (c, name) => {
  for (let x = c, n = 0; x && n < 20; x = classes.get(x.parent), n++)
    if (x[name]) return x[name];
  return undefined;
};
const actions = [...classes.values()]
  .filter((c) => c.registered)
  .map((c) => {
    const keys = inherit(c, "keys");
    const modes = inherit(c, "modes");
    const seqs = keys?.value
      ? Array.isArray(keys.value[0])
        ? keys.value
        : [keys.value]
      : null;
    return {
      class: c.name,
      file: c.file,
      line: c.line,
      modes: modes?.value?.map((m) => m.replace(/^<Mode\.|>$/g, "")) ?? null,
      keys: seqs,
      ...(keys?.unparsed ? { keysUnparsed: keys.unparsed } : {}),
      ...(modes?.unparsed ? { modesUnparsed: modes.unparsed } : {}),
    };
  });
writeFileSync(
  outFile,
  JSON.stringify(
    {
      source: "VSCodeVim v1.32.4 src/**/*.ts, read statically",
      actions,
    },
    null,
    1,
  ) + "\n",
);
console.log(
  `${actions.length} registered actions, ${actions.filter((a) => !a.keys).length} without parsed keys, ${actions.filter((a) => !a.modes).length} without parsed modes`,
);
