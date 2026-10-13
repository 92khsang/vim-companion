// The shared fixtures (design §5): the shapes of their files, and the index of their cases, which
// the runner of each IDE compares with the cases it ran.
import type { FixtureFiles } from "./validate.mts";

/**
 * The text of generated/fixtures-index.json: the case ids of each fixture set as "<file stem>/<id>",
 * sorted. version-order.json holds one case, "ascending".
 */
export function fixtureIndex(files: FixtureFiles): string {
  return "";
}
