// Vendors the ripgrep binary that `search_content` runs (SRCH-3, SEC-3, D31).
// Installs the release asset for this machine's architecture into vendor/ripgrep/rg.

import { execFile } from "node:child_process";
import { chmod, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { downloadVerified, type VendorStep } from "./step.ts";

const runFile = promisify(execFile);

const version = "15.2.0";

/** SHA-256 of each release archive, checked against the `.sha256` files published with 15.2.0. */
const archiveChecksums: Record<string, { target: string; sha256: string }> = {
  arm64: {
    target: "aarch64-apple-darwin",
    sha256: "3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4",
  },
  x64: {
    target: "x86_64-apple-darwin",
    sha256: "af7825fcc69a2afc7a7aea55fc9af90e26421d8f20fe59df32e233c0b8a231c1",
  },
};

export const ripgrepStep: VendorStep = {
  name: "ripgrep",
  version,
  async install(targetDirectory) {
    const archive = archiveChecksums[process.arch];
    if (!archive) throw new Error(`No pinned ripgrep build for architecture ${process.arch}`);
    const folderName = `ripgrep-${version}-${archive.target}`;
    const url = `https://github.com/BurntSushi/ripgrep/releases/download/${version}/${folderName}.tar.gz`;

    const workDirectory = await mkdtemp(join(tmpdir(), "vix-vendor-ripgrep-"));
    try {
      const archivePath = join(workDirectory, `${folderName}.tar.gz`);
      await downloadVerified(url, archive.sha256, archivePath);
      // Extract only the binary; the archive also carries docs and shell completions.
      await runFile("tar", ["-xzf", archivePath, "-C", workDirectory, `${folderName}/rg`]);
      const binaryPath = join(targetDirectory, "rg");
      await rename(join(workDirectory, folderName, "rg"), binaryPath);
      await chmod(binaryPath, 0o755);
    } finally {
      await rm(workDirectory, { recursive: true, force: true });
    }
  },
};
