// Measures the fixed overhead (CTX-5): the system prompt plus the tool definitions every
// request carries. Exported so integration and evals can measure with the real counter.

import type { LmClient, ToolDefinition } from "../contracts/index.ts";
import { ToolRegistry } from "./registry.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import type { ToolCallingStyle } from "./types.ts";

export interface FixedOverheadOptions {
  lm: LmClient;
  tools: readonly ToolDefinition[];
  workingDirectory: string;
  style: ToolCallingStyle;
}

/**
 * Tool schemas are counted as their JSON text in a system message. LM Studio's chat
 * template renders them with some extra framing, so treat the number as a close estimate.
 */
export async function measureFixedOverhead(options: FixedOverheadOptions): Promise<number> {
  const tools = new ToolRegistry(options.tools).list();
  const systemPrompt = buildSystemPrompt({
    workingDirectory: options.workingDirectory,
    style: options.style,
    tools,
    references: [],
  });
  const schemaText =
    options.style === "native" ? JSON.stringify(tools.map((tool) => tool.schema)) : "";
  return options.lm.countTokens([{ role: "system", content: `${systemPrompt}\n${schemaText}` }]);
}
