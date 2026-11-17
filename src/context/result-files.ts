// File-level helpers for the result store: private permissions, file names, and line streaming.

import { createReadStream } from "node:fs";
import { chmod, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { ResultHandle, ResultMeta } from "../contracts/index.ts";
import { handleNumber } from "./handles.ts";

/** Stored results can hold sensitive cell values (SEC-6), so only the user may read them. */
export const privateFileMode = 0o600;
export const privateDirectoryMode = 0o700;

const metaSuffix = ".meta.json";

export function dataFileName(handle: ResultHandle, kind: ResultMeta["kind"]): string {
  // Row sets are JSON Lines (D16) so DuckDB can read the file directly.
  return kind === "rows" ? `${handle}.jsonl` : `${handle}.txt`;
}

export function metaFilePath(directory: string, handle: ResultHandle): string {
  return join(directory, `${handle}${metaSuffix}`);
}

export async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: privateDirectoryMode });
  // mkdir leaves an existing directory's mode alone, so set it explicitly.
  await chmod(directory, privateDirectoryMode);
}

/**
 * The highest handle number already in the directory. Handles must survive resume,
 * so numbering continues from what is on disk instead of restarting at r1.
 */
export async function highestStoredHandleNumber(directory: string): Promise<number> {
  let highest = 0;
  for (const name of await readdir(directory)) {
    const handle = name.split(".")[0] ?? "";
    const value = handleNumber(handle);
    if (value !== undefined && value > highest) highest = value;
  }
  return highest;
}

/**
 * Yields each line of a file. Streams, so a large result is never loaded whole;
 * the file is closed as soon as the caller stops reading.
 */
export async function* readLines(filePath: string): AsyncGenerator<string> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  try {
    yield* lines;
  } finally {
    lines.close();
    stream.destroy();
  }
}
