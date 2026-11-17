// Test helpers that read an office file back with something other than the writer: the
// project's own OOXML reader for the parts of a package, and macOS `textutil` as a reader
// that shares no code with clankr. Test code only.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ZipArchive } from "../../tools/data/inspect/zip-archive.ts";

const runCommand = promisify(execFile);

/** The plain text of a document as macOS reads it, one paragraph or table cell per line. */
export async function textutilText(path: string): Promise<string> {
  const { stdout } = await runCommand("/usr/bin/textutil", ["-convert", "txt", "-stdout", path]);
  return stdout;
}

/** One part of an OOXML package, such as "word/document.xml" or "word/media/image1.png". */
export async function readPackagePart(path: string, partName: string): Promise<Buffer> {
  const archive = await ZipArchive.open(path);
  try {
    return await archive.read(partName);
  } finally {
    await archive.close();
  }
}

export async function hasPackagePart(path: string, partName: string): Promise<boolean> {
  const archive = await ZipArchive.open(path);
  try {
    return archive.has(partName);
  } finally {
    await archive.close();
  }
}
