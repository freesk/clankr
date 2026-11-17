// Reading and writing text files while keeping their shape: line endings, trailing
// newline, and permissions survive an edit, and a crash never leaves half a file.

import { randomBytes } from "node:crypto";
import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { ToolError } from "../../contracts/index.ts";

export type LineEnding = "\n" | "\r\n";

export interface TextFile {
  /** Contents with every line ending turned into "\n". */
  text: string;
  lineEnding: LineEnding;
  endsWithNewline: boolean;
}

/** How far into a file to look for a NUL byte. Text files never contain one. */
const binarySniffBytes = 8192;

export function looksBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, binarySniffBytes).includes(0);
}

export async function readTextFile(path: string, displayName: string): Promise<TextFile> {
  const bytes = await readFile(path);
  if (looksBinary(bytes)) {
    throw new ToolError(`${displayName} is a binary file. These tools only change text files.`);
  }
  return parseText(bytes.toString("utf8"));
}

export function parseText(raw: string): TextFile {
  const lineEnding: LineEnding = raw.includes("\r\n") ? "\r\n" : "\n";
  const text = raw.replace(/\r\n/g, "\n");
  return { text, lineEnding, endsWithNewline: text.endsWith("\n") };
}

/** Text from the model, normalized to "\n" so it can be compared with a parsed file. */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/** Gives new text the shape of the file it replaces. */
export function shapeLike(text: string, original: TextFile): string {
  let shaped = text;
  // An empty file has no trailing-newline habit to keep.
  if (original.text !== "") {
    if (original.endsWithNewline && shaped !== "" && !shaped.endsWith("\n")) shaped += "\n";
    if (!original.endsWithNewline) shaped = shaped.replace(/\n+$/, "");
  }
  return original.lineEnding === "\r\n" ? shaped.replace(/\n/g, "\r\n") : shaped;
}

export function refuseBinaryContent(content: string, displayName: string): void {
  if (content.includes("\0")) {
    throw new ToolError(
      `The content for ${displayName} contains a NUL byte. Only text can be written.`,
    );
  }
}

/**
 * Writes to a temporary file beside the target and renames it into place. A rename within
 * one folder is atomic, so readers see the old file or the new one, never a mix.
 */
export async function writeFileAtomically(
  path: string,
  content: string | Buffer,
  mode?: number,
): Promise<void> {
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.vix-${randomBytes(4).toString("hex")}.tmp`,
  );
  try {
    await writeFile(temporaryPath, content, { flag: "wx" });
    if (mode !== undefined) await chmod(temporaryPath, mode);
    await rename(temporaryPath, path);
  } catch (error) {
    // The temporary file is ours, never the user's, so removing it is safe.
    await rm(temporaryPath, { force: true });
    throw error;
  }
}
