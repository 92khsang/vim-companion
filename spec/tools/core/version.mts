// Versions as the catalog writes them: SemVer 2.0.0 (https://semver.org/spec/v2.0.0.html) without
// build metadata, x.y.z[-prerelease]. An alias stays active until the version in its `until`.

/** -1, 0 or 1 as `a` sorts before, with or after `b` in SemVer 2.0.0 precedence. */
export function compareVersions(a: string, b: string): number {
  return Number(a > b) - Number(a < b);
}
