// The shared fixtures (design §5) against the core: every case of spec/fixtures runs, and the cases
// that ran are exactly those of spec/generated/fixtures-index.json, which the IntelliJ runner reads
// as well.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { readFixtureFiles, readSchemas } from "../tools/catalog-files.mts";
import type {
  CatalogFixture,
  FixtureIndex,
  HintViewFixture,
  VersionOrderFixture,
} from "../tools/core/fixtures.mts";
import { resolve } from "../tools/core/resolve.mts";
import { rows } from "../tools/core/rows.mts";
import { stemOf, validateFixtures } from "../tools/core/validate.mts";
import { compareVersions } from "../tools/core/version.mts";

const specDir = join(import.meta.dirname, "..");
const files = readFixtureFiles(specDir);
const index = JSON.parse(
  readFileSync(join(specDir, "generated/fixtures-index.json"), "utf8"),
) as FixtureIndex;
/** The global ids of the cases that ran, by fixture set. */
const ran: FixtureIndex = { catalog: [], "hint-view": [], "version-order": [] };

test("the fixture files pass the checks of spec:check", () => {
  expect(validateFixtures(files, readSchemas(specDir))).toEqual([]);
});

describe.each(
  files.catalog.map(({ path, data }) => ({
    stem: stemOf(path),
    fixture: data as CatalogFixture,
  })),
)("catalog/$stem", ({ stem, fixture }) => {
  test.each(fixture.cases)(
    "$id",
    ({ id, ide, options, keys, expect: result }) => {
      ran.catalog.push(`${stem}/${id}`);
      expect(resolve(fixture.catalog, ide, keys, options)).toEqual(result);
    },
  );
});

describe.each(
  files.hintView.map(({ path, data }) => ({
    stem: stemOf(path),
    fixture: data as HintViewFixture,
  })),
)("hint-view/$stem", ({ stem, fixture }) => {
  test.each(fixture.cases)(
    "$id",
    ({ id, ide, options, prefix, rows: list }) => {
      ran["hint-view"].push(`${stem}/${id}`);
      expect(rows(fixture.catalog, ide, prefix, options)).toEqual(list);
    },
  );
});

describe("version-order", () => {
  test("ascending", () => {
    ran["version-order"].push("ascending");
    const { ascending } = files.versionOrder.data as VersionOrderFixture;
    // Every pair, not only neighbours: each version sorts before every later one.
    const pairs = ascending.flatMap((a, i) =>
      ascending.slice(i + 1).map((b) => [a, b] as const),
    );
    const symbol = (order: number) => ["<", "=", ">"][order + 1];
    expect(
      pairs.flatMap(([a, b]) => [
        `${a} ${symbol(compareVersions(a, b))} ${b}`,
        `${b} ${symbol(compareVersions(b, a))} ${a}`,
      ]),
    ).toEqual(pairs.flatMap(([a, b]) => [`${a} < ${b}`, `${b} > ${a}`]));
  });
});

test("ran exactly the cases of generated/fixtures-index.json", () => {
  expect({
    catalog: [...ran.catalog].sort(),
    "hint-view": [...ran["hint-view"]].sort(),
    "version-order": [...ran["version-order"]].sort(),
  }).toEqual(index);
});
