import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { compareVersions } from "../tools/core/version.mts";

// SemVer 2.0.0 versions without build metadata, written out independently of the implementation.
// Most parts come from a few values, so that equal majors, minors, patches and identifiers are
// common; a few numbers are beyond the safe integers of a double.
const number = fc.oneof(
  { arbitrary: fc.constantFrom("0", "1", "2", "10"), weight: 4 },
  { arbitrary: fc.nat().map(String), weight: 1 },
  { arbitrary: fc.bigInt({ min: 0n, max: 10n ** 30n }).map(String), weight: 1 },
);
// An alphanumeric identifier has at least one letter or hyphen.
const alphanumeric = fc.oneof(
  {
    arbitrary: fc.constantFrom(
      "alpha",
      "beta",
      "rc",
      "a1",
      "1a",
      "0a",
      "-",
      "--",
      "A",
      "B-2",
    ),
    weight: 4,
  },
  {
    arbitrary: fc.stringMatching(
      /^[0-9A-Za-z-]{0,3}[A-Za-z-][0-9A-Za-z-]{0,3}$/,
    ),
    weight: 1,
  },
);
const version = fc
  .tuple(
    number,
    number,
    number,
    fc.array(fc.oneof(number, alphanumeric), { maxLength: 3 }),
  )
  .map(
    ([major, minor, patch, prerelease]) =>
      `${major}.${minor}.${patch}${prerelease.length > 0 ? `-${prerelease.join(".")}` : ""}`,
  );

/** The sign of compareVersions, with -0 as 0. */
const order = (a: string, b: string): number =>
  Math.sign(compareVersions(a, b)) + 0;

describe("compareVersions", () => {
  test("is antisymmetric and transitive, and returns 0 exactly for equal versions", () => {
    fc.assert(
      fc.property(version, version, version, (a, b, c) => {
        expect(order(a, b) === 0).toBe(a === b);
        expect(order(b, a)).toBe(-order(a, b) + 0);
        if (order(a, b) <= 0 && order(b, c) <= 0) {
          expect(order(a, c)).toBeLessThanOrEqual(0);
        }
      }),
      { numRuns: 1000 },
    );
  });

  test("compares major, minor and patch as numbers, in that order", () => {
    expect([
      compareVersions("1.0.0", "2.0.0"),
      compareVersions("2.0.0", "2.1.0"),
      compareVersions("2.1.0", "2.1.1"),
      compareVersions("2.1.1", "2.1.1"),
      compareVersions("2.1.1", "2.1.0"),
      compareVersions("1.9.0", "1.10.0"),
      compareVersions("1.0.10", "1.0.9"),
      compareVersions("9.9.9", "10.0.0"),
      compareVersions("2.0.0", "1.99.99"),
      compareVersions("123456789012345678901.0.0", "123456789012345678902.0.0"),
    ]).toEqual([-1, -1, -1, 0, 1, -1, 1, -1, 1, -1]);
  });
});
