import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const coreDir = join(import.meta.dirname, "../tools/core");
const files = readdirSync(coreDir, {
  recursive: true,
  encoding: "utf8",
}).filter((f) => f.endsWith(".mts"));
// `from "x"`, `import("x")` and the side-effect form `import "x"`.
const specifiers =
  /\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s+["']([^"']+)["']/g;
const pure = (s: string): boolean =>
  s.startsWith("./") || s === "ajv" || s.startsWith("ajv/");

test.each(files)("tools/core/%s imports only pure modules", (file) => {
  const source = readFileSync(join(coreDir, file), "utf8");
  const impure = [...source.matchAll(specifiers)]
    .map((m) => m[1] ?? m[2] ?? m[3] ?? "")
    .filter((s) => !pure(s));
  expect(impure).toEqual([]);
  expect(source).not.toMatch(/\bprocess\.|\bfetch\(/);
});
