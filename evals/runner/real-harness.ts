// The harness factory for a real run against LM Studio. Wave 2 wires it, once
// agent-loop's runTurn, the LM Studio client, and the tools exist. Until then
// `npm run evals` stops here with a clear message (only `--dry-run` works).
//
// What wave 2 builds here, per run:
// - Load config with `allowedRoots: [setup.workingDirectory]` and the run's ClankrPaths.
// - Create the real LmClient and wrap it in UsageRecordingLmClient; report its tally.
// - Build the session and tool registry, and adapt runTurn with bindRunTurn.
// - Answer approval prompts automatically ("once"), so a run never waits on a person.
// - Expose the registry's tool names (checked for PERM-6) and the slash commands.

import type { HarnessFactory } from "./harness.ts";

export function createRealHarnessFactory(): HarnessFactory {
  throw new Error(
    "The real harness is not wired yet: it needs agent-loop's runTurn and the LM Studio client (wave 2). " +
      "Use `npm run evals -- --dry-run` to validate the tasks and fixtures.",
  );
}
