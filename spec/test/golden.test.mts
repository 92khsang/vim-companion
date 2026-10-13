// The goldens of design §7.5: each directory under golden/ holds a complete mini catalog in
// catalog/ and, in expected/, exactly the files that genIde returns for it. The first one was
// written by hand; add a case with `pnpm test --update=new` and read every file it writes.
import { existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { expect, test } from "vitest";
import { readCatalogFiles } from "../tools/catalog-files.mts";
import { genIde } from "../tools/core/gen.mts";
import { validateCatalog } from "../tools/core/validate.mts";
import { loadSchemas } from "./support/mini-catalog.mts";

const goldenDir = join(import.meta.dirname, "golden");

test.each(readdirSync(goldenDir).sort())(
  "genIde returns the files of golden/%s/expected",
  async (name) => {
    const caseDir = join(goldenDir, name);
    const expectedDir = join(caseDir, "expected");
    const { catalog, diagnostics } = validateCatalog(
      readCatalogFiles(caseDir),
      loadSchemas(),
    );
    expect(diagnostics).toEqual([]);
    const out = genIde(catalog!);
    for (const [path, text] of out) {
      await expect(text).toMatchFileSnapshot(join(expectedDir, path));
    }
    // A new case has no expected/ directory until `--update=new` writes it, after the test ends.
    const onDisk = existsSync(expectedDir)
      ? readdirSync(expectedDir, { recursive: true, withFileTypes: true })
          .filter((dirent) => dirent.isFile())
          .map((dirent) =>
            relative(expectedDir, join(dirent.parentPath, dirent.name))
              .split(sep)
              .join("/"),
          )
      : [];
    // A missing file fails toMatchFileSnapshot; this catches a file that genIde no longer returns.
    expect(onDisk.filter((path) => !out.has(path))).toEqual([]);
  },
);
