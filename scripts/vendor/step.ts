// The vendoring convention (SEC-3, D31). Each part that needs a third-party asset at
// run time adds one VendorStep in its own file under scripts/vendor/ and lists it in
// steps.ts. Every step pins a version and verifies a checksum. Nothing is fetched at
// run time: the harness only ever reads what these steps put in vendor/.

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface VendorStep {
  /** Folder under vendor/ that this step owns, for example "ripgrep". */
  name: string;
  /** The pinned version, recorded in vendor/<name>/VERSION after a successful install. */
  version: string;
  /** Install into `targetDirectory` (vendor/<name>). Must be safe to re-run. */
  install(targetDirectory: string): Promise<void>;
}

/** Downloads a file and refuses to keep it unless its SHA-256 matches the pinned value. */
export async function downloadVerified(
  url: string,
  expectedSha256: string,
  destination: string,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `Checksum mismatch for ${url}: expected ${expectedSha256}, got ${actualSha256}`,
    );
  }
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
}

export async function sha256OfFile(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

export async function resetDirectory(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
}
