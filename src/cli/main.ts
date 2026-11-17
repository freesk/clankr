// The `vix` entry point. The cli part replaces this placeholder (specs/cli.md).
//
// Startup rule (PRD section 9, 500 ms): nothing heavy is imported at the top level
// of any module reachable from here. DuckDB, isolated-vm, sharp, Playwright, and Ink
// are loaded with `await import()` at the point of use.

import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

const commandLineArguments = process.argv.slice(2);

if (commandLineArguments.includes("--version") || commandLineArguments.includes("-v")) {
  console.log(`vix ${packageJson.version}`);
} else {
  console.error("vix: not implemented yet (foundation scaffold only). Try `vix --version`.");
  process.exitCode = 2;
}
