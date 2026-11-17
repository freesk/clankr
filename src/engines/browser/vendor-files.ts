// Where the vendored browser and Vega builds live on disk (SEC-3, D31). Nothing here is
// fetched at run time: a missing file means `npm run vendor` has not been run.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

// Three levels up from both src/engines/browser/ and dist/engines/browser/.
const vendorDirectory = resolve(import.meta.dirname, "..", "..", "..", "vendor");

export const chromiumExecutablePath = join(
  vendorDirectory,
  "chromium",
  `chrome-headless-shell-mac-${process.arch}`,
  "chrome-headless-shell",
);

export const vegaDirectory = join(vendorDirectory, "vega");

/** The Vega browser builds the render page loads, by file name. */
export const vegaBrowserFiles = ["vega.min.js", "vega-lite.min.js", "vega-interpreter.js"];

export const vegaLiteSchemaPath = join(vegaDirectory, "vega-lite-schema.json");

export class MissingVendorFileError extends Error {
  override readonly name = "MissingVendorFileError";
}

export function assertVendored(paths: string[]): void {
  const missing = paths.filter((path) => !existsSync(path));
  if (missing.length > 0) {
    throw new MissingVendorFileError(
      `Missing vendored file ${missing.join(", ")}. Run \`npm run vendor\` to install it.`,
    );
  }
}

/** True when every file the renderer needs is installed. Tests use it to skip cleanly. */
export function isBrowserVendored(): boolean {
  const required = [
    chromiumExecutablePath,
    ...vegaBrowserFiles.map((file) => join(vegaDirectory, file)),
  ];
  return required.every((path) => existsSync(path));
}
