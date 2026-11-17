// A minimal ZIP writer (stored entries, no compression), enough to build a
// .docx fixture without a document library.

import { crc32 } from "node:zlib";

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const dosDateJanuaryFirst1980 = 0x21;

export function createZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const checksum = crc32(entry.data);
    const local = localFileHeader(name, entry.data.length, checksum);
    centralParts.push(centralDirectoryHeader(name, entry.data.length, checksum, offset));
    localParts.push(local, entry.data);
    offset += local.length + entry.data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  return Buffer.concat([
    ...localParts,
    centralDirectory,
    endOfCentralDirectory(entries.length, centralDirectory.length, offset),
  ]);
}

function localFileHeader(name: Buffer, size: number, checksum: number): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0, 6); // flags
  header.writeUInt16LE(0, 8); // stored
  header.writeUInt16LE(0, 10); // time
  header.writeUInt16LE(dosDateJanuaryFirst1980, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(size, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, name]);
}

function centralDirectoryHeader(name: Buffer, size: number, checksum: number, offset: number) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4); // version made by
  header.writeUInt16LE(20, 6); // version needed
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(dosDateJanuaryFirst1980, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(size, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(name.length, 28);
  // Extra field, comment, disk number, and attributes stay zero.
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, name]);
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
