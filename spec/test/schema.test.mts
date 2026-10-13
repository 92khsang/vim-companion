import { Ajv2020 } from "ajv/dist/2020.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

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
