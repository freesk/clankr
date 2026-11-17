// Vendor step for the pdf part: the Chromium headless shell that Playwright drives (SEC-3, D31).
// The build matches the pinned playwright-core version (its browsers.json), so the
// protocol Playwright speaks and the browser it talks to always agree.

import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { downloadVerified, type VendorStep } from "./step.ts";

const runCommand = promisify(execFile);

/** Chrome for Testing build that playwright-core 1.64.1 expects. */
const chromiumVersion = "156.0.8078.4";

const archiveSha256ByArchitecture: Record<string, string> = {
  arm64: "94e4337b70cbc5638f0935fbc46b9f242bc7416f657e3fbe924baf348404b53d",
};

function archiveName(architecture: string): string {
  return `chrome-headless-shell-mac-${architecture}.zip`;
}

export const chromiumStep: VendorStep = {
  name: "chromium",
  version: `chrome-headless-shell ${chromiumVersion} (playwright-core 1.64.1)`,
  async install(targetDirectory) {
    const architecture = process.arch;
    const expectedSha256 = archiveSha256ByArchitecture[architecture];
    if (process.platform !== "darwin" || !expectedSha256) {
      throw new Error(
        `No pinned Chromium build for ${process.platform}-${architecture}; clankr supports Apple silicon macOS`,
      );
    }
    const url = `https://cdn.playwright.dev/builds/cft/${chromiumVersion}/mac-${architecture}/${archiveName(architecture)}`;
    const archivePath = join(targetDirectory, archiveName(architecture));
    await downloadVerified(url, expectedSha256, archivePath);
    // `unzip` keeps the executable bits and ships with macOS; an argument array, no shell.
    await runCommand("unzip", ["-q", archivePath, "-d", targetDirectory]);
    await rm(archivePath);
  },
};
