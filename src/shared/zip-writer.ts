// A minimal ZIP writer, enough to build an OOXML package (.docx) without a document library.
// Entries are stored as they are unless `compress` asks for deflate. Timestamps are fixed, so
// the same entries give the same bytes on every run.

import { crc32, deflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  data: Buffer;
  /** Deflate the entry. Leave out for data that is already compressed, such as a PNG. */
  compress?: boolean;
}

/** One entry as the archive holds it. */
interface PackedEntry {
  name: Buffer;
  /** The bytes written to the archive: deflated or as given. */
  body: Buffer;
  originalSize: number;
  checksum: number;
  method: number;
}

const dosDateJanuaryFirst1980 = 0x21;
const methodStored = 0;
const methodDeflated = 8;

export function createZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const packed = packEntry(entry);
    const local = localFileHeader(packed);
    centralParts.push(centralDirectoryHeader(packed, offset));
    localParts.push(local, packed.body);
    offset += local.length + packed.body.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  return Buffer.concat([
    ...localParts,
    centralDirectory,
    endOfCentralDirectory(entries.length, centralDirectory.length, offset),
  ]);
}

function packEntry(entry: ZipEntry): PackedEntry {
  return {
    name: Buffer.from(entry.name, "utf8"),
    body: entry.compress ? deflateRawSync(entry.data) : entry.data,
    originalSize: entry.data.length,
    checksum: crc32(entry.data),
    method: entry.compress ? methodDeflated : methodStored,
  };
}

function localFileHeader(entry: PackedEntry): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0, 6); // flags
  header.writeUInt16LE(entry.method, 8);
  header.writeUInt16LE(0, 10); // time
  header.writeUInt16LE(dosDateJanuaryFirst1980, 12);
  header.writeUInt32LE(entry.checksum, 14);
  header.writeUInt32LE(entry.body.length, 18);
  header.writeUInt32LE(entry.originalSize, 22);
  header.writeUInt16LE(entry.name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, entry.name]);
}

function centralDirectoryHeader(entry: PackedEntry, offset: number): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4); // version made by
  header.writeUInt16LE(20, 6); // version needed
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(entry.method, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(dosDateJanuaryFirst1980, 14);
  header.writeUInt32LE(entry.checksum, 16);
  header.writeUInt32LE(entry.body.length, 20);
  header.writeUInt32LE(entry.originalSize, 24);
  header.writeUInt16LE(entry.name.length, 28);
  // Extra field, comment, disk number, and attributes stay zero.
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, entry.name]);
}

function endOfCentralDirectory(entryCount: number, size: number, offset: number): Buffer {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(entryCount, 8);
  record.writeUInt16LE(entryCount, 10);
  record.writeUInt32LE(size, 12);
  record.writeUInt32LE(offset, 16);
  return record;
}
