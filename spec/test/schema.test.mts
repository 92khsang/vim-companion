import { Ajv2020 } from "ajv/dist/2020.js";
import fc from "fast-check";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { validateFixtures } from "../tools/core/validate.mts";
import { isVersion } from "../tools/core/version.mts";
import { loadSchemas } from "./support/mini-catalog.mts";
import { miniFixtureFiles } from "./support/mini-fixtures.mts";

const schemaDir = join(import.meta.dirname, "../schema");

test("every schema is JSON Schema 2020-12 and compiles in ajv strict mode", () => {
  const names = existsSync(schemaDir)
    ? readdirSync(schemaDir)
        .filter((name) => name.endsWith(".json"))
        .sort()
    : [];
  expect(names).toEqual(
    expect.arrayContaining([
      "commands.schema.json",
      "ctrl-keys.schema.json",
      "groups.schema.json",
      "retired-ids.schema.json",
    ]),
  );
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  for (const name of names) {
    const schema = JSON.parse(readFileSync(join(schemaDir, name), "utf8"));
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    ajv.addSchema(schema, name);
  }
  // Compiling applies the strict-mode checks. The fixture schemas $ref the entry and group shapes.
  const refs = [
    ...names,
    "commands.schema.json#/$defs/entry",
    "groups.schema.json#/$defs/group",
  ];
  expect(
    refs.filter((ref) => typeof ajv.getSchema(ref) !== "function"),
  ).toEqual([]);
});

test("spec:check accepts as a fixture version exactly the strings isVersion accepts", () => {
  const schemas = loadSchemas();
  // Near-versions: parts with leading zeros, letters or nothing, and build metadata; and short
  // strings of version characters.
  const part = fc.constantFrom(
    "0",
    "1",
    "10",
    "01",
    "",
    "a",
    "-",
    "rc",
    "1a",
    "A-1",
  );
  const nearVersion = fc
    .tuple(
      part,
      part,
      part,
      fc.array(part, { maxLength: 3 }),
      fc.constantFrom("", "+b", "+1.2"),
    )
    .map(
      ([major, minor, patch, prerelease, build]) =>
        `${major}.${minor}.${patch}${prerelease.length > 0 ? `-${prerelease.join(".")}` : ""}${build}`,
    );
  const text = fc.string({
    unit: fc.constantFrom(..."01.-+aZ "),
    maxLength: 12,
  });
  // spec:check reads each version of the order alone; the conformance runner checks the order.
  // Each run compiles the schemas, so 20 runs of 50 versions check 1000 candidates. minLength is 50
  // too: by default fast-check draws at most 2 * minLength + 10 items, 12 for minLength 1.
  const message = (version: string, i: number) =>
    `ascending[${i}] ${JSON.stringify(version)} is not a version x.y.z[-prerelease]`;
  fc.assert(
    fc.property(
      fc.array(fc.oneof(nearVersion, text), { minLength: 50, maxLength: 50 }),
      (candidates) => {
        const files = miniFixtureFiles();
        files.versionOrder.data.ascending = ["0.0.0", ...candidates];
        expect(validateFixtures(files, schemas)).toEqual(
          candidates
            .flatMap((candidate, i) =>
              isVersion(candidate) ? [] : [message(candidate, i + 1)],
            )
            .sort()
            .map((text) => ({
              file: "spec/fixtures/version-order.json",
              where: "ascending",
              code: "VERSION",
              message: text,
            })),
        );
      },
    ),
    { numRuns: 20 },
  );
});
