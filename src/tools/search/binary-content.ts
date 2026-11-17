// Tells `read_file` when a file is not text, and which tool the model should use
// instead (SRCH-5). The pointer matters more than the refusal: a small model that is
// told "use view_image" recovers in one step.

import type { FileHandle } from "node:fs/promises";
import { extensionOf, kindExtensions } from "./file-kinds.ts";

/** Bytes inspected at the start of a file. Enough to see a NUL in any real binary format. */
const sampleSize = 8192;
/** Share of control characters above which a file without NULs still counts as binary. */
const maxControlCharacterShare = 0.1;

const imageSignatures: number[][] = [
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0xff, 0xd8, 0xff], // JPEG
  [0x47, 0x49, 0x46, 0x38], // GIF
];

/** Formats inspect_data reads (specs/inspect.md). */
const inspectableExtensions = ["xlsx", "xls", "docx"];

export async function looksBinary(file: FileHandle): Promise<boolean> {
  const sample = Buffer.alloc(sampleSize);
  const { bytesRead } = await file.read(sample, 0, sampleSize, 0);
  const bytes = sample.subarray(0, bytesRead);
  if (bytes.includes(0)) return true;
  if (startsWithAny(bytes, imageSignatures)) return true;
  let controlCharacters = 0;
  for (const byte of bytes) {
    // Tab, line feed, form feed, and carriage return are ordinary in text.
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0c && byte !== 0x0d) {
      controlCharacters++;
    }
  }
  return bytesRead > 0 && controlCharacters / bytesRead > maxControlCharacterShare;
}

/** The refusal message for a binary file, naming the right tool where one exists. */
export function binaryFilePointer(displayName: string): string {
  const extension = extensionOf(displayName);
  if (kindExtensions.image.includes(extension)) {
    return `${displayName} is an image. Use view_image to ask about it.`;
  }
  if (inspectableExtensions.includes(extension)) {
    return `${displayName} is a spreadsheet or document. Use inspect_data to read it.`;
  }
  if (extension === "pdf") {
    return `${displayName} is a PDF; read_file reads text files only, and vix has no PDF reader yet.`;
  }
  return `${displayName} is a binary file; read_file reads text only.`;
}

function startsWithAny(bytes: Buffer, signatures: number[][]): boolean {
  return signatures.some((signature) => signature.every((byte, index) => bytes[index] === byte));
}
