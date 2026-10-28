// Check the exact eight images embedded in the preliminary U1 review index.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const commit = process.argv[2] === "--commit" ? process.argv[3] : null;
if (commit) assert.match(commit, /^[a-f0-9]{40}$/);

const root = fileURLToPath(new URL("../../spikes/u1/", import.meta.url));
const index = readFileSync(join(root, "README.md"), "utf8");
const images = [...index.matchAll(/!\[[^\]]*\]\((gallery\/[^)]+\.png)\)/g)].map(
  (match) => match[1],
);
const records = ["vscode", "intellij"].flatMap(
  (ide) =>
    JSON.parse(readFileSync(join(root, `gallery/${ide}-capture.json`), "utf8"))
      .captures,
);
assert.equal(images.length, 8);
assert.equal(new Set(images).size, 8);
assert.equal(records.length, 8);
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
  const record = records.find((item) => path === `gallery/${item.file}`);
  assert.ok(record, path);
  assert.equal(png.readUInt32BE(16), record.width, path);
  assert.equal(png.readUInt32BE(20), record.height, path);
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
  `8 embedded PNGs decode and match their recorded capture dimensions${commit ? "; HTTP 200 at " + commit : ""}.`,
);
