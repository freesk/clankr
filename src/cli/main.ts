// The `clankr` entry point (specs/cli.md).
//
// Startup rule (PRD section 9, 500 ms): nothing heavy is imported at the top level
// of any module reachable from here. DuckDB, isolated-vm, sharp, Playwright, and Ink
// are loaded with `await import()` at the point of use.

import { fstatSync, readFileSync } from "node:fs";
import type { CliEnvironment, StdinMode } from "./cli-environment.ts";
import { createComposition } from "./composition.ts";
import { runCli } from "./run-cli.ts";

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

function detectStdinMode(): StdinMode {
  if (process.stdin.isTTY) return "terminal";
  try {
    const stats = fstatSync(0);
    return stats.isFIFO() || stats.isFile() ? "piped" : "other";
  } catch {
    return "other";
  }
}

const environment: CliEnvironment = {
  argv: process.argv.slice(2),
  stdin: process.stdin,
  stdinMode: detectStdinMode(),
  stdout: process.stdout,
  stderr: process.stderr,
  environment: process.env,
  workingDirectory: process.cwd(),
  version: packageJson.version,
  composition: createComposition(),
  onInterrupt(handler) {
    process.on("SIGINT", handler);
    return () => process.off("SIGINT", handler);
  },
  forceExit(code) {
    process.exit(code);
  },
};

const exitCode = await runCli(environment);
// Exit once stdout has drained: pipes are asynchronous on macOS, and an open handle
// left by another part (a socket, a timer) must not keep a finished run alive.
process.stdout.write("", () => process.exit(exitCode));
