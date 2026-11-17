// DuckDB is a heavy native addon, so it is imported on first use, never at startup
// (foundation spec: lazy native modules keep the 500 ms startup target).

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { ToolError } from "../../contracts/index.ts";

export type DuckDbModule = typeof import("@duckdb/node-api");

let loading: Promise<DuckDbModule> | undefined;

export function loadDuckDb(): Promise<DuckDbModule> {
  loading ??= import("@duckdb/node-api");
  return loading;
}

/** The `excel` extension installed by `npm run vendor -- duckdb-excel` (scripts/vendor/duckdb-excel.ts). */
export const excelExtensionPath = join(
  resolve(import.meta.dirname, "..", "..", ".."),
  "vendor",
  "duckdb-excel",
  "v1.4.5",
  "osx_arm64",
  "excel.duckdb_extension",
);

export function isExcelExtensionInstalled(): boolean {
  return existsSync(excelExtensionPath);
}

export function requireExcelExtension(): string {
  if (!isExcelExtensionInstalled()) {
    throw new ToolError(
      "The .xlsx reader is not installed. Ask the user to run `npm run vendor` in the clankr folder.",
    );
  }
  return excelExtensionPath;
}
