// Check the component and IDE-context images embedded in the U1 review index.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { vscodeCases, intellijCases } from "./u1-matrix.mjs";

const commit = process.argv[2] === "--commit" ? process.argv[3] : null;
if (commit) assert.match(commit, /^[a-f0-9]{40}$/);

const root = fileURLToPath(new URL("../../spikes/u1/", import.meta.url));
const index = readFileSync(join(root, "README.md"), "utf8");
const images = [...index.matchAll(/!\[[^\]]*\]\((gallery\/[^)]+\.png)\)/g)].map(
  (match) => match[1],
);
const records = [
  "vscode-capture",
  "intellij-capture",
  "vscode-context",
  "intellij-context",
  "vscode-matrix",
  "intellij-matrix",
].flatMap((ide) => {
  const evidence = JSON.parse(
    readFileSync(join(root, `gallery/${ide}.json`), "utf8"),
  );
  if (ide === "intellij-capture" || ide === "intellij-context") {
    assert.equal(evidence.awtToolkit, "sun.awt.X11.XToolkit");
    assert.equal(evidence.backgroundWriteActionProperty, "false");
  }
  return evidence.captures;
});
const original = ["vscode", "intellij"].flatMap((ide) =>
  [
    "idle",
    "prefix",
    "badges",
    "grammar",
    "vim-reference",
    "vim-d",
    "vim-di",
    "vim-f",
    "vim-register",
    "vim-unavailable",
    "context-single",
    "context-split",
    "context-small-split",
    "context-small-hidden",
  ].map((state) => `gallery/${ide}-${state}.png`),
);
const expected = [
  ...new Set([
    ...original,
    ...vscodeCases.map((cell) => `gallery/${cell.name}.png`),
    ...intellijCases.map((cell) => `gallery/${cell.name}.png`),
  ]),
];
assert.equal(expected.length, 72);
assert.deepEqual(
  [...images].sort(),
  [...expected].sort(),
  "Review images must preserve every original case and cover the complete theme/size matrix",
);
assert.deepEqual(
  [...new Set(records.map((record) => `gallery/${record.file}`))].sort(),
  [...expected].sort(),
);
for (const path of images) {
  let png;
  if (commit) {
    const response = await fetch(
      `https://raw.githubusercontent.com/92khsang/vim-companion/${commit}/spikes/u1/${path}`,
    );
    assert.equal(response.status, 200, path);
    png = Buffer.from(await response.arrayBuffer());
  } else {
    png = readFileSync(join(root, path));
  }
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", path);
  const matches = records.filter((item) => path === `gallery/${item.file}`);
  assert.ok(matches.length, path);
  for (const record of matches) {
    assert.equal(png.readUInt32BE(16), record.width, path);
    assert.equal(png.readUInt32BE(20), record.height, path);
  }
  execFileSync(
    "python3",
    [
      "-c",
      "from PIL import Image; import io,sys; image=Image.open(io.BytesIO(sys.stdin.buffer.read())); image.load(); assert image.format == 'PNG'",
    ],
    { input: png },
  );
}
console.log(
  `${images.length} embedded PNGs decode and match their recorded capture dimensions${commit ? "; HTTP 200 at " + commit : ""}.`,
);
