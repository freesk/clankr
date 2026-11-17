// Shared shapes for the assertion checks.

import type { FixtureSnapshot } from "../fixtures/materialize.ts";
import type { ToolCallRecord } from "../runner/transcript.ts";

/** Everything an assertion may look at after a run. Never the model's wording beyond facts. */
export interface AssertionContext {
  workingDirectory: string;
  fixtureSnapshot: FixtureSnapshot;
  finalAnswer: string;
  toolCalls: ToolCallRecord[];
  activeModelKey: string | undefined;
}

/** Undefined when the check passed; otherwise the reason it failed. */
export type CheckResult = Promise<string | undefined>;
