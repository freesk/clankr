// A minimal reader for the zip container of `.xlsx` and `.docx` files. It reads the
// central directory from the end of the file and inflates single entries on demand,
// so detecting a format or reading a workbook's sheet list never loads the whole file.

import type { FileHandle } from "node:fs/promises";
import { open } from "node:fs/promises";
import { constants, inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const endOfDirectorySignature = 0x06054b50;
const directoryEntrySignature = 0x02014b50;
const localHeaderSignature = 0x04034b50;
const endRecordMinimumLength = 22;
const maximumCommentLength = 0xffff;
const methodStored = 0;
const methodDeflated = 8;

export class ZipArchive {
  readonly entries: ZipEntry[];
  private readonly handle: FileHandle;

  private constructor(handle: FileHandle, entries: ZipEntry[]) {
    this.handle = handle;
    this.entries = entries;
  }

  static async open(path: string): Promise<ZipArchive> {
    const handle = await open(path, "r");
    try {
      return new ZipArchive(handle, await readDirectory(handle));
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  has(name: string): boolean {
    return this.entries.some((entry) => entry.name === name);
  }

  /** The whole entry, inflated. Only for entries known to be small (XML parts of a document). */
  async read(name: string): Promise<Buffer> {
    const entry = this.require(name);
    const compressed = await this.compressedBytes(entry, entry.compressedSize);
    return entry.method === methodStored ? compressed : inflateRawSync(compressed);
  }

  /** Roughly the first `byteCount` bytes of an entry, without reading the rest of it. */
  async readStart(name: string, byteCount: number): Promise<Buffer> {
    const entry = this.require(name);
    const compressed = await this.compressedBytes(entry, Math.min(entry.compressedSize, byteCount));
    if (entry.method === methodStored) return compressed;
    return inflateRawSync(compressed, { finishFlush: constants.Z_SYNC_FLUSH });
  }

  close(): Promise<void> {
    return this.handle.close();
  }

  private require(name: string): ZipEntry {
    const entry = this.entries.find((candidate) => candidate.name === name);
    if (!entry) throw new Error(`Zip entry ${name} not found`);
    if (entry.method !== methodStored && entry.method !== methodDeflated) {
      throw new Error(`Zip entry ${name} uses unsupported compression ${entry.method}`);
    }
    return entry;
  }

  private async compressedBytes(entry: ZipEntry, length: number): Promise<Buffer> {
    const header = await readAt(this.handle, entry.localHeaderOffset, 30);
    if (header.readUInt32LE(0) !== localHeaderSignature) throw new Error("Corrupt zip entry");
    const dataOffset =
      entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    return readAt(this.handle, dataOffset, length);
  }
}

async function readDirectory(handle: FileHandle): Promise<ZipEntry[]> {
  const { size } = await handle.stat();
  const tailLength = Math.min(size, endRecordMinimumLength + maximumCommentLength);
  const tail = await readAt(handle, size - tailLength, tailLength);
  const endOffset = tail.lastIndexOf(signatureBytes(endOfDirectorySignature));
  if (endOffset < 0) throw new Error("Not a zip archive: no central directory");
  const entryCount = tail.readUInt16LE(endOffset + 10);
  const directorySize = tail.readUInt32LE(endOffset + 12);
  const directoryOffset = tail.readUInt32LE(endOffset + 16);
  if (directoryOffset === 0xffffffff) throw new Error("ZIP64 archives are not supported");
  return parseDirectory(await readAt(handle, directoryOffset, directorySize), entryCount);
}

function parseDirectory(directory: Buffer, entryCount: number): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;
  for (let index = 0; index < entryCount; index++) {
    if (directory.readUInt32LE(offset) !== directoryEntrySignature) {
      throw new Error("Corrupt zip central directory");
    }
    const nameLength = directory.readUInt16LE(offset + 28);
    const extraLength = directory.readUInt16LE(offset + 30);
    const commentLength = directory.readUInt16LE(offset + 32);
    entries.push({
      method: directory.readUInt16LE(offset + 10),
      compressedSize: directory.readUInt32LE(offset + 20),
      uncompressedSize: directory.readUInt32LE(offset + 24),
      localHeaderOffset: directory.readUInt32LE(offset + 42),
      name: directory.toString("utf8", offset + 46, offset + 46 + nameLength),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function signatureBytes(signature: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(signature);
  return bytes;
}

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}
