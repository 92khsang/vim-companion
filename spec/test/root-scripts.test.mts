import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

type Manifest = { name: string; scripts: Record<string, string> };

function manifestIn(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}

const spec = manifestIn(join(import.meta.dirname, ".."));
const root = manifestIn(join(import.meta.dirname, "../.."));

/** The scripts of the spec package that the root runs (design §1). */
const SPEC_SCRIPTS = [
  "test",
  "typecheck",
  "gen",
  "spec:check",
  "check-ids",
  "ids:refresh",
];

// When a filter matches no project, pnpm prints "No projects matched the filters" and exits 0, so
// a renamed package or a mistyped filter would turn every check into a pass that ran nothing.
// pnpm reads --fail-if-no-match only before the script name; after it, the script gets the flag.
test("the root runs each spec script by the package name and fails when no project matches", () => {
  const filtered = Object.entries(root.scripts).filter(([, command]) =>
    /^pnpm (?:-F|--filter) /.test(command),
  );
  expect({
    delegated: Object.fromEntries(
      SPEC_SCRIPTS.map((name) => [name, root.scripts[name]]),
    ),
    withoutFlag: filtered
      .filter(
        ([, command]) =>
          !/^pnpm (?:-F|--filter) \S+ --fail-if-no-match [^-\s]/.test(command),
      )
      .map(([name]) => name),
  }).toEqual({
    delegated: Object.fromEntries(
      SPEC_SCRIPTS.map((name) => [
        name,
        `pnpm -F ${spec.name} --fail-if-no-match ${name}`,
      ]),
    ),
    withoutFlag: [],
  });
});
