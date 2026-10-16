// Validates spec/fixtures/grammar/*.json against spec/schema/fixture-grammar.schema.json in ajv
// strict mode, checks that case ids are unique per file and prints the number of cases and reads.
// Usage: node spike/s2/tools/validate-grammar.mjs
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "../../..");
const require = createRequire(join(root, "spec/package.json"));
const { Ajv2020 } = require("ajv/dist/2020.js");

const ajv = new Ajv2020({ strict: true, allErrors: true });
const schema = JSON.parse(
  readFileSync(join(root, "spec/schema/fixture-grammar.schema.json"), "utf8"),
);
const validate = ajv.compile(schema);
const dir = join(root, "spec/fixtures/grammar");
let cases = 0;
let reads = 0;
let failed = false;
for (const name of readdirSync(dir)
  .filter((n) => n.endsWith(".json"))
  .sort()) {
  const data = JSON.parse(readFileSync(join(dir, name), "utf8"));
  if (!validate(data)) {
    failed = true;
    console.log(`${name}: ${ajv.errorsText(validate.errors)}`);
    continue;
  }
  const ids = new Set();
  for (const c of data.cases) {
    if (ids.has(c.id)) {
      failed = true;
      console.log(`${name}: duplicate id ${c.id}`);
    }
    ids.add(c.id);
    cases += 1;
    reads += c.steps.length + (c.afterTimeout ? 1 : 0);
  }
}
console.log(`${cases} cases, ${reads} state reads`);
process.exit(failed ? 1 : 0);
