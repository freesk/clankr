// DuckDB reads delimited files only as UTF-8 (its `latin-1` mode rejects the 0x80-0x9F
// bytes Windows uses for curly quotes and dashes). Government and spreadsheet exports are
// often Windows-1252, so such a file is converted once into the session's scratch folder
// and DuckDB reads the copy. Scratch is inside the session, so wipe and --ephemeral cover it.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Reads the whole file once; stops at the first byte sequence that is not UTF-8. */
export async function isUtf8File(path: string): Promise<boolean> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for await (const chunk of createReadStream(path)) {
      decoder.decode(chunk as Buffer, { stream: true });
    }
    decoder.decode();
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes a UTF-8 copy of a Windows-1252 file into `scratchDirectory` and returns its path.
 * The name includes a hash of the source path, so two files with the same name do not clash.
 */
export async function writeUtf8Copy(sourcePath: string, scratchDirectory: string): Promise<string> {
  await mkdir(scratchDirectory, { recursive: true, mode: 0o700 });
  const tag = createHash("sha256").update(sourcePath).digest("hex").slice(0, 8);
  const copyPath = join(scratchDirectory, `${tag}-${basename(sourcePath)}.utf8`);
  const decoder = new TextDecoder("windows-1252");
  await pipeline(
    createReadStream(sourcePath),
    new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        callback(null, decoder.decode(chunk, { stream: true }));
      },
      flush(callback) {
        callback(null, decoder.decode());
      },
    }),
    createWriteStream(copyPath, { mode: 0o600 }),
  );
  return copyPath;
}
