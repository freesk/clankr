// cli part. See specs/cli.md. The entry point is main.ts; integration edits composition.ts.
// Nothing here imports Ink: the REPL loads it lazily.

export type { CliComposition, Harness, HarnessOptions } from "./harness.ts";
export { runCli } from "./run-cli.ts";
