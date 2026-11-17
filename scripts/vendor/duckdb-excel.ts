// The sql part's vendor step: DuckDB's `excel` extension (read_xlsx), pinned to the
// DuckDB version in package.json (D37). The engine LOADs it from vendor/ by path, with
// autoinstall and autoload off, so DuckDB never fetches an extension at run time.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { downloadVerified, sha256OfFile, type VendorStep } from "./step.ts";

const duckDbVersion = "v1.4.5";
const platform = "osx_arm64";
const extensionFileName = "excel.duckdb_extension";
const downloadUrl = `https://extensions.duckdb.org/${duckDbVersion}/${platform}/${extensionFileName}.gz`;
const compressedSha256 = "8f21f4dc1425bcd0fa97e74de930b0802246916758b4a6de5f50e4ba59a50681";
const extensionSha256 = "19b5bd58df23449085bd25c5da2a4a420b5f077beade78c6e6d1e3a0d819242d";

export const duckDbExcelStep: VendorStep = {
  name: "duckdb-excel",
  version: `${duckDbVersion}-${platform}`,
  async install(targetDirectory) {
    const compressedPath = join(targetDirectory, `${extensionFileName}.gz`);
    const extensionPath = join(targetDirectory, duckDbVersion, platform, extensionFileName);
    await downloadVerified(downloadUrl, compressedSha256, compressedPath);
    await writeFileCreatingFolders(extensionPath, gunzipSync(await readFile(compressedPath)));
    await rm(compressedPath);
    const actualSha256 = await sha256OfFile(extensionPath);
    if (actualSha256 !== extensionSha256) {
      throw new Error(`Checksum mismatch for ${extensionFileName}: got ${actualSha256}`);
    }
  },
};

async function writeFileCreatingFolders(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}
