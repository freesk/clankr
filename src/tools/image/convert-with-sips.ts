// Converts formats the bundled libvips cannot decode (HEIC, BMP) with macOS `sips` (IMG-4).
// `sips` ships with macOS and works offline. It is started with an argument array, never
// through a shell, and none of its arguments come from the model except the resolved path.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ToolError } from "../../contracts/index.ts";

const runFile = promisify(execFile);

/** Absolute, so a `sips` earlier on PATH cannot stand in for the system one. */
export const sipsPath = "/usr/bin/sips";

export interface SipsConversionOptions {
  scratchDirectory: string;
  timeoutMs: number;
  signal: AbortSignal;
}

/** Returns the image as PNG bytes. The temporary file in the scratch directory is removed. */
export async function convertToPngWithSips(
  inputPath: string,
  options: SipsConversionOptions,
): Promise<Buffer> {
  await mkdir(options.scratchDirectory, { recursive: true });
  const outputPath = join(options.scratchDirectory, `view-image-${randomUUID()}.png`);
  try {
    await runSips(["-s", "format", "png", inputPath, "--out", outputPath], options);
    return await readFile(outputPath);
  } finally {
    await rm(outputPath, { force: true });
  }
}

async function runSips(args: string[], options: SipsConversionOptions): Promise<void> {
  try {
    await runFile(sipsPath, args, { timeout: options.timeoutMs, signal: options.signal });
  } catch (error) {
    if (options.signal.aborted) throw error;
    throw new ToolError(sipsFailureMessage(error));
  }
}

function sipsFailureMessage(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT") {
    return "Converting this format needs the macOS sips command, which was not found.";
  }
  return "The image could not be converted. It may be damaged; try another file.";
}
