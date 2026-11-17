// Writing an output file that must not exist yet (D28). The caller picks a free name; the
// exclusive flag makes a race fail loudly instead of overwriting someone's file.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ChartRenderResult } from "../contracts/index.ts";

export async function writeNewFile(path: string, bytes: Buffer): Promise<ChartRenderResult> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "wx" });
  return { path, sizeBytes: bytes.length };
}
