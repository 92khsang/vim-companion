// Writes a zip archive of stored (uncompressed) text files: enough for unzip to read the jars of a
// fake IntelliJ install. Layout: APPNOTE.TXT 4.3 (local headers, central directory, end record).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { crc32 } from "node:zlib";

/** 1980-01-01, the first date that the DOS format can hold. */
const DOS_DATE = (1 << 5) | 1;

export function writeZip(path: string, files: Record<string, string>): void {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(text, "utf8");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(10, 4); // version needed: stored entries
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(10, 4); // version made by
    entry.writeUInt16LE(10, 6); // version needed
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc32(data), 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    local.push(header, nameBytes, data);
    central.push(entry, nameBytes);
    offset += header.length + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((size, part) => size + part.length, 0);
  const count = Object.keys(files).length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat([...local, ...central, end]));
}
