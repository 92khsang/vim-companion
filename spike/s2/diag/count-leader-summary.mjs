// Summarizes the bounded cold-session diagnosis. These observations are not a differential row.
// E in qi-observe means outside the quick-input widget; it does not prove engine consumption.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2];
if (!dir)
  throw new Error(
    "usage: node count-leader-summary.mjs <diagnostic directory>",
  );
for (const version of ["1.134.0", "1.141.0"]) {
  for (const arm of ["off", "on"]) {
    const records = readFileSync(join(dir, `${arm}-${version}.jsonl`), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
    const counts = {
      observations: 0,
      closed: 0,
      outsideQuickInput: 0,
      menuOpen: 0,
      errors: 0,
      badAdapter: 0,
      rootAfterB: 0,
    };
    for (const record of records) {
      if (record.type !== "obs") {
        counts.errors++;
        continue;
      }
      counts.observations++;
      if (!record.adapterCheck?.ok) counts.badAdapter++;
      const log = record.log;
      const states = log.filter((x) => x[1] === "qi");
      const keys = log.filter((x) => x[1] === "key b" || x[1] === "key n");
      const outside = keys.some((x) => x[2] === "E");
      const open = states.at(-1)?.[2].startsWith("V");
      if (outside) counts.outsideQuickInput++;
      if (open) counts.menuOpen++;
      if (!outside && !open) counts.closed++;
      const bTime = keys.find((x) => x[1] === "key b")?.[0];
      if (states.some((x) => x[0] > bTime && x[2] === "V||7|␣\tFind file"))
        counts.rootAfterB++;
    }
    const builds = [...new Set(records.map((r) => r.build?.id ?? "none"))];
    const dirty = records.some((r) => !r.build || r.build.dirty.length);
    console.log(JSON.stringify({ version, arm, ...counts, builds, dirty }));
  }
}
