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
  return compareText(x.prerelease, y.prerelease);
}

/** Major, minor and patch, and the text after the first "-". */
function parse(text: string): { core: string[]; prerelease: string } {
  const dash = text.indexOf("-");
  return dash < 0
    ? { core: text.split("."), prerelease: "" }
    : {
        core: text.slice(0, dash).split("."),
        prerelease: text.slice(dash + 1),
      };
}

/** Numbers without leading zeros, of any length: the longer is larger. */
function compareNumbers(a: string, b: string): number {
  return Math.sign(a.length - b.length) || compareText(a, b);
}

function compareText(a: string, b: string): number {
  return Number(a > b) - Number(a < b);
}
