import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, writeFile, stat, unlink, access } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";

async function digest(stream) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { bytes, sha256: hash.digest("hex") };
}
async function absent(file) {
  try {
    await access(file);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new Error("refusing to overwrite " + file);
}
const metadataFile = (file) => file + ".sha256.json";

export async function verifyArchive(file) {
  assert.ok(file.endsWith(".gz"));
  const manifest = JSON.parse(await readFile(metadataFile(file), "utf8"));
  assert.equal(manifest.format, "s1-gzip-v1");
  assert.equal(manifest.name, basename(file.slice(0, -3)));
  const compressed = await digest(createReadStream(file));
  assert.deepEqual(compressed, manifest.compressed, "compressed bytes changed");
  const decoded = await digest(createReadStream(file).pipe(createGunzip()));
  assert.deepEqual(decoded, manifest.original, "decoded bytes changed");
  return manifest;
}

export async function packArtifact(file) {
  const output = file + ".gz";
  await absent(output);
  await absent(metadataFile(output));
  const before = await stat(file, { bigint: true });
  assert.ok(before.isFile(), "archive input must be a regular file");
  const hash = createHash("sha256");
  let bytes = 0;
  await pipeline(
    createReadStream(file),
    new Transform({
      transform(chunk, encoding, done) {
        bytes += chunk.length;
        hash.update(chunk);
        done(null, chunk);
      },
    }),
    createGzip({ level: 9 }),
    createWriteStream(output, { flags: "wx" }),
  );
  const after = await stat(file, { bigint: true });
  assert.equal(after.size, before.size, "input changed during compression");
  assert.equal(
    after.mtimeNs,
    before.mtimeNs,
    "input changed during compression",
  );
  const original = { bytes, sha256: hash.digest("hex") };
  assert.deepEqual(
    await digest(createReadStream(output).pipe(createGunzip())),
    original,
    "archive round trip differs from original bytes",
  );
  const manifest = {
    format: "s1-gzip-v1",
    name: basename(file),
    original,
    compressed: await digest(createReadStream(output)),
  };
  await writeFile(
    metadataFile(output),
    JSON.stringify(manifest, null, 2) + "\n",
    {
      flag: "wx",
    },
  );
  // Originals are retained. Packing does not alter evidence or its qualification.
  return manifest;
}

export async function restoreArtifact(file) {
  const manifest = await verifyArchive(file);
  const output = file.slice(0, -3);
  try {
    const existing = await digest(createReadStream(output));
    assert.deepEqual(existing, manifest.original, "existing original differs");
    return { ...manifest, restored: false };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let created = false;
  const destination = createWriteStream(output, { flags: "wx" });
  destination.once("open", () => (created = true));
  try {
    await pipeline(createReadStream(file), createGunzip(), destination);
    assert.deepEqual(await digest(createReadStream(output)), manifest.original);
  } catch (error) {
    if (created) await unlink(output);
    throw error;
  }
  return { ...manifest, restored: true };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const [action, ...files] = process.argv.slice(2);
  const operation = {
    pack: packArtifact,
    verify: verifyArchive,
    restore: restoreArtifact,
  }[action];
  assert.ok(
    operation && files.length,
    "usage: archive.mjs pack|verify|restore FILE [...]",
  );
  for (const file of files) {
    const result = await operation(file);
    console.log(JSON.stringify({ file, ...result }));
  }
}
