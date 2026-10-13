// The shared fixtures (design §5): the shapes of their files, and the index of their cases, which
// the runner of each IDE compares with the cases it ran.
import type { Ide, KeyCatalog } from "./catalog.mts";
import type { Resolution, ResolveOptions } from "./resolve.mts";
import type { Row } from "./rows.mts";
import { stemOf, type CatalogFile, type FixtureFiles } from "./validate.mts";

/** fixtures/catalog/*.json: where the leader keys of each case lead. */
export type CatalogFixture = {
  $schema?: string;
  description: string;
  catalog: KeyCatalog;
  cases: {
    id: string;
    ide: Ide;
    options?: ResolveOptions;
    keys: string[];
    expect: Resolution;
  }[];
};

/** fixtures/hint-view/*.json: the rows of the prefix of each case. */
export type HintViewFixture = {
  $schema?: string;
  description: string;
  catalog: KeyCatalog;
  cases: {
    id: string;
    ide: Ide;
    options?: ResolveOptions;
    prefix: string[];
    rows: Row[];
  }[];
};

/** fixtures/version-order.json: each version sorts strictly before the next. */
export type VersionOrderFixture = { $schema?: string; ascending: string[] };

/** generated/fixtures-index.json: the global case ids of each fixture set, sorted. */
export type FixtureIndex = {
  catalog: string[];
  "hint-view": string[];
  "version-order": string[];
};

/**
 * The text of generated/fixtures-index.json: the case ids of each fixture set as "<file stem>/<id>",
 * sorted. version-order.json holds one case, "ascending".
 */
export function fixtureIndex(files: FixtureFiles): string {
  const index: FixtureIndex = {
    catalog: caseIds(files.catalog),
    "hint-view": caseIds(files.hintView),
    "version-order": ["ascending"],
  };
  return `${JSON.stringify(index, null, 2)}\n`;
}

/** "<file stem>/<id>" for each case of the files, in code-unit order. */
function caseIds(files: readonly CatalogFile[]): string[] {
  return files
    .flatMap((file) =>
      (file.data as { cases: { id: string }[] }).cases.map(
        ({ id }) => `${stemOf(file.path)}/${id}`,
      ),
    )
    .sort();
}
