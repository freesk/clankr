// Vendor step for the chart and pdf parts: the Vega, Vega-Lite, and Vega expression
// interpreter browser builds, and the Vega-Lite JSON schema (SEC-3, D3). Taken from the
// npm registry tarballs, which are immutable, rather than from a CDN's minified copies.

import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { downloadVerified, type VendorStep } from "./step.ts";

const runCommand = promisify(execFile);

interface PinnedPackage {
  name: string;
  version: string;
  tarballSha256: string;
  /** Files inside the tarball to copy into vendor/vega/, relative to its `package/` folder. */
  files: string[];
}

const pinnedPackages: PinnedPackage[] = [
  {
    name: "vega",
    version: "6.4.0",
    tarballSha256: "3521fb6ff68a94a40323954f0ba4484ba4014b157bfd37f89a3b063082320c42",
    files: ["build/vega.min.js"],
  },
  {
    name: "vega-lite",
    version: "6.5.0",
    tarballSha256: "811230a6bfd2cdbfc359d0c38f624a90df86657b7f251b67be88bcc4eee32b7f",
    files: ["build/vega-lite.min.js", "build/vega-lite-schema.json"],
  },
  {
    name: "vega-interpreter",
    version: "2.3.2",
    tarballSha256: "b83489633c1320e9d6f839781f0c84c661a5ca2666fe38cb83f7c52a531fffec",
    files: ["build/vega-interpreter.js"],
  },
];

async function installPackage(pinned: PinnedPackage, targetDirectory: string): Promise<void> {
  const workDirectory = await mkdtemp(join(tmpdir(), `vix-vendor-${pinned.name}-`));
  try {
    const tarballPath = join(workDirectory, `${pinned.name}.tgz`);
    const url = `https://registry.npmjs.org/${pinned.name}/-/${pinned.name}-${pinned.version}.tgz`;
    await downloadVerified(url, pinned.tarballSha256, tarballPath);
    const members = pinned.files.map((file) => `package/${file}`);
    await runCommand("tar", ["-xzf", tarballPath, "-C", workDirectory, ...members]);
    for (const member of members) {
      await copyFile(join(workDirectory, member), join(targetDirectory, basename(member)));
    }
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}

export const vegaStep: VendorStep = {
  name: "vega",
  version: pinnedPackages.map((pinned) => `${pinned.name}@${pinned.version}`).join(" "),
  async install(targetDirectory) {
    for (const pinned of pinnedPackages) await installPackage(pinned, targetDirectory);
  },
};
