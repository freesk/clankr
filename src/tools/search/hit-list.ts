// Turns ranked, formatted hits into a tool result. Applies the hit-count cap and,
// when hits are left over, stores the full list behind a handle so the model can page
// through it with `read_result` (SRCH-6). The token cap is the agent loop's job.

import type { ToolContext, ToolOutput } from "../../contracts/index.ts";

export interface HitListInput {
  tool: string;
  arguments: Record<string, unknown>;
  /** Short label for the stored result, for example "find_files *.pdf under ~". */
  label: string;
  /** Lines above the hits: the root and a count. */
  header: string[];
  /** One entry per hit, best first. An entry may span several lines. */
  entries: string[];
  /** Lines below the hits: fallbacks used, limits reached. */
  notes: string[];
  /** Most entries to show. */
  cap: number;
  /** Shown when there are no entries at all. */
  emptyMessage: string;
}

export async function buildHitList(input: HitListInput, context: ToolContext): Promise<ToolOutput> {
  if (input.entries.length === 0) {
    return { text: [...input.header, input.emptyMessage, ...input.notes].join("\n") };
  }
  if (input.entries.length <= input.cap) {
    return { text: [...input.header, ...input.entries, ...input.notes].join("\n") };
  }

  const fullText = [...input.header, ...input.entries].join("\n");
  const handle = await context.results.putText(fullText, {
    tool: input.tool,
    arguments: input.arguments,
    label: input.label,
  });
  const remaining = input.entries.length - input.cap;
  const pointer = `… ${remaining.toLocaleString("en-US")} more. Full ranked list: result ${handle} (page through it with read_result).`;
  const shown = input.entries.slice(0, input.cap);
  return {
    text: [...input.header, ...shown, pointer, ...input.notes].join("\n"),
    handles: [handle],
  };
}
