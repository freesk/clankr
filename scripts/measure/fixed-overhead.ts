// Measures CTX-5 (fixed overhead: system prompt plus tool definitions) against a running
// LM Studio, using the server's own prompt_tokens for a one-token request. Needs LM_API_TOKEN.
// Usage: node --no-node-snapshot scripts/measure/fixed-overhead.ts [model-key]

import { ToolRegistry } from "../../src/agent/registry.ts";
import { buildSystemPrompt } from "../../src/agent/system-prompt.ts";
import { inspectToolDefinitions, offeredToolSets } from "../../src/app/tool-set.ts";
import { defaultConfig } from "../../src/config/index.ts";

const modelKey = process.argv[2] ?? "google/gemma-4-12b-qat";
const token = process.env.LM_API_TOKEN;
if (!token) throw new Error("Set LM_API_TOKEN");

const tools = inspectToolDefinitions(defaultConfig());

async function promptTokens(
  messages: unknown[],
  toolSchemas: unknown[] | undefined,
): Promise<number> {
  const response = await fetch("http://localhost:1234/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ model: modelKey, messages, tools: toolSchemas, max_tokens: 1 }),
  });
  const body = (await response.json()) as { usage?: { prompt_tokens: number } };
  if (!body.usage) throw new Error(`No usage in response: ${JSON.stringify(body).slice(0, 200)}`);
  return body.usage.prompt_tokens;
}

const userMessage = { role: "user", content: "hi" };
const baseline = await promptTokens([userMessage], undefined);
for (const [label, include] of Object.entries(offeredToolSets)) {
  const selected = new ToolRegistry(tools.filter((tool) => include(tool.groups))).list();
  const systemPrompt = buildSystemPrompt({
    workingDirectory: "/Users/me/work",
    style: "native",
    tools: selected,
    references: [],
  });
  const schemas = selected.map((tool) => ({ type: "function", function: tool.schema }));
  const total = await promptTokens(
    [{ role: "system", content: systemPrompt }, userMessage],
    schemas,
  );
  console.log(
    `${label.padEnd(12)} ${String(selected.length).padStart(2)} tools  fixed overhead ${total - baseline} tokens`,
  );
}
for (const tool of new ToolRegistry(tools).list()) {
  const withTool = await promptTokens([userMessage], [{ type: "function", function: tool.schema }]);
  console.log(`  ${tool.schema.name.padEnd(16)} ${withTool - baseline}`);
}
