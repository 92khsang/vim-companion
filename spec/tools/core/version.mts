// Versions as the catalog writes them: SemVer 2.0.0 (https://semver.org/spec/v2.0.0.html) without
// build metadata, x.y.z[-prerelease]. An alias stays active until the version in its `until`.

/** -1, 0 or 1 as `a` sorts before, with or after `b` in SemVer 2.0.0 precedence. */
export function compareVersions(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const order = compareNumbers(x.core[i]!, y.core[i]!);
    if (order !== 0) return order;
  }
  // A release has no identifiers and sorts after each of its prereleases.
  if (x.prerelease.length === 0 || y.prerelease.length === 0) {
    return Math.sign(y.prerelease.length - x.prerelease.length);
  }
  for (let i = 0; i < x.prerelease.length && i < y.prerelease.length; i++) {
    const order = compareIdentifiers(x.prerelease[i]!, y.prerelease[i]!);
    if (order !== 0) return order;
  }
  // When one list of identifiers starts the other, the longer list sorts last.
  return Math.sign(x.prerelease.length - y.prerelease.length);
}

/** Major, minor and patch, and the prerelease identifiers ([] for a release). */
function parse(text: string): { core: string[]; prerelease: string[] } {
  const dash = text.indexOf("-");
  return dash < 0
    ? { core: text.split("."), prerelease: [] }
    : {
        core: text.slice(0, dash).split("."),
        prerelease: text.slice(dash + 1).split("."),
      };
}

const NUMERIC = /^[0-9]+$/;

/** Numeric identifiers compare as numbers and sort before the others, which compare as ASCII. */
function compareIdentifiers(a: string, b: string): number {
  const numeric = NUMERIC.test(a);
  if (numeric !== NUMERIC.test(b)) return numeric ? -1 : 1;
  return numeric ? compareNumbers(a, b) : compareText(a, b);
}

/** Numbers without leading zeros, of any length: the longer is larger. */
function compareNumbers(a: string, b: string): number {
  return Math.sign(a.length - b.length) || compareText(a, b);
}

function compareText(a: string, b: string): number {
  return Number(a > b) - Number(a < b);
}

// A number has no leading zeros. A prerelease identifier is a number or [0-9A-Za-z-]+ with at least
// one letter or hyphen.
const NUMBER = "(?:0|[1-9][0-9]*)";
const IDENTIFIER = `(?:${NUMBER}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const VERSION = new RegExp(
  `^${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-${IDENTIFIER}(?:\\.${IDENTIFIER})*)?$`,
);

/** Whether the text is a SemVer 2.0.0 version without build metadata. */
export function isVersion(text: string): boolean {
  return VERSION.test(text);
}
