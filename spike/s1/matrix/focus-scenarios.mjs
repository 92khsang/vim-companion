import assert from "node:assert/strict";

export function focusScenarios(catalog) {
  const states = {
    "c q": ["one", "many", "none"],
    "c r": ["allowed", "rejected"],
    "c f": [
      "single",
      "multiple-dialog",
      "unavailable-dialog",
      "multiple-configure",
      "unavailable-configure",
    ],
    "c d": ["first", "visible", "accessible"],
    "f p": ["workspace", "outside-hidden", "outside-visible"],
    "g g": ["no-repository", "commit", "resource-focused"],
    "b d": ["clean", "dirty"],
    "b o": ["clean", "dirty"],
    "w c": ["clean", "dirty"],
    "w o": ["clean", "dirty"],
  };
  const rows = catalog.leaves.flatMap((leaf) =>
    (states[leaf.keys.join(" ")] ?? ["default"]).map((state) => ({
      id: leaf.keys.join("").replace("/", "slash") + "-" + state,
      leaf,
      state,
      delayed: false,
    })),
  );
  assert.equal(rows.length, 43);
  rows.sort(
    (a, b) =>
      Number(b.state === "no-repository") - Number(a.state === "no-repository"),
  );
  for (const key of ["q", "r", "f", "d"])
    rows.push({
      id: "delayed-c" + key,
      leaf: catalog.leaves.find((leaf) => leaf.keys.join(" ") === "c " + key),
      state:
        key === "q"
          ? "many"
          : key === "r"
            ? "allowed"
            : key === "f"
              ? "single"
              : "first",
      delayed: true,
    });
  return rows;
}
