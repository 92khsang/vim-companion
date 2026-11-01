import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, unlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { packArtifact, verifyArchive, restoreArtifact } from "./archive.mjs";

test("lossless archives preserve exact bytes, reject corruption and never replace evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "s1-archive-test-"));
  try {
    const file = join(directory, "raw.json"),
      archive = file + ".gz";
    const bytes = Buffer.from('{ "trial": 1, "text": "\\ud55c" }\r\n');
    await writeFile(file, bytes);
    const manifest = await packArtifact(file);
    assert.equal(manifest.original.bytes, bytes.length);
    assert.deepEqual(await readFile(file), bytes);
    assert.deepEqual(await verifyArchive(archive), manifest);
    assert.equal((await restoreArtifact(archive)).restored, false);
    await assert.rejects(packArtifact(file), /refusing to overwrite/);
    await unlink(file);
    assert.equal((await restoreArtifact(archive)).restored, true);
    assert.deepEqual(await readFile(file), bytes);
    await writeFile(file, "unrelated existing evidence");
    await assert.rejects(restoreArtifact(archive), /existing original differs/);
    assert.equal(await readFile(file, "utf8"), "unrelated existing evidence");
    const compressed = await readFile(archive);
    compressed[compressed.length - 1] ^= 1;
    await writeFile(archive, compressed);
    await assert.rejects(verifyArchive(archive), /compressed bytes changed/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
