// CTX-5 regression guard over the real tool definitions: system prompt plus the offered
// tools must stay under budget, so a longer description cannot creep in unnoticed.
//
// The fake counter estimates 4 characters per token. On Gemma 4 12B the real count
// (LM Studio's prompt_tokens, `scripts/measure/fixed-overhead.ts`) ran about 9% above this
// estimate once the descriptions were trimmed, because the schema framing that remains
// tokenizes densely. The ceilings below are the real targets divided by 1.09:
//   core         real 1,400 (headroom under the 1,500 budget)  ->  estimate 1,285
//   core+vision  real 1,500                                      ->  estimate 1,376
//   all          real about 2,100 (data tools come only with a data file, D15)  ->  1,927
// "all" was 2,000 (estimate 1,835) until export_table joined the data group (task 34): its
// definition is about 148 estimated tokens, and make_chart's format list grew by about 11.
// If the real ratio changes, re-measure and update these numbers together.

import { describe, expect, it } from "vitest";
import { measureFixedOverhead } from "../agent/index.ts";
import { defaultConfig } from "../config/index.ts";
import { ScriptedLmClient } from "../testing/index.ts";
import { inspectToolDefinitions, offeredToolSets } from "./tool-set.ts";

const estimateCeilings: Record<string, number> = {
  core: 1_285,
  "core+vision": 1_376,
  all: 1_927,
};

describe("fixed overhead of the real tools (CTX-5)", () => {
  const tools = inspectToolDefinitions(defaultConfig());

  for (const [label, isOffered] of Object.entries(offeredToolSets)) {
    it(`keeps ${label} under its ceiling`, async () => {
      const offered = tools.filter((tool) => isOffered(tool.groups));
      const tokens = await measureFixedOverhead({
        lm: new ScriptedLmClient(),
        tools: offered,
        workingDirectory: "/Users/someone/Documents/projects",
        style: "native",
      });
      // Logged so the number is visible in the test output, not only pass or fail.
      console.log(`fixed overhead, ${label}, ${offered.length} tools: ${tokens} estimated tokens`);
      expect(tokens).toBeLessThanOrEqual(estimateCeilings[label] ?? 0);
    });
  }
});
