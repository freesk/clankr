// Piped stdin for one-shot mode (CLI-2). Stdin can be large, so it is treated like a tool
// result: over the cap it goes to the result store and the prompt gets a preview and a handle.

import type { Harness } from "./harness.ts";

const previewLineCount = 20;
const previewCharacterLimit = 2_000;

export async function readStream(stream: AsyncIterable<string | Buffer>): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  }
  return chunks.join("");
}

/** The prompt sent for `-p "prompt"` with stdin piped in, or for piped stdin alone. */
export async function combinePromptWithPipedInput(
  prompt: string | undefined,
  piped: string,
  harness: Pick<Harness, "config" | "lm" | "results">,
): Promise<string> {
  const trimmed = piped.replace(/\s+$/, "");
  if (trimmed === "") return prompt ?? "";
  const inputSection = await fitPipedInput(trimmed, harness);
  return prompt ? `${prompt}\n\n${inputSection}` : inputSection;
}

async function fitPipedInput(
  piped: string,
  harness: Pick<Harness, "config" | "lm" | "results">,
): Promise<string> {
  const cap = harness.config.context.defaultResultTokenCap;
  const tokens = await harness.lm.countTokens([{ role: "user", content: piped }]);
  if (tokens <= cap) return piped;

  const handle = await harness.results.putText(piped, {
    tool: "stdin",
    arguments: {},
    label: "piped stdin",
  });
  const lines = piped.split("\n");
  const preview = lines.slice(0, previewLineCount).join("\n").slice(0, previewCharacterLimit);
  return [
    `Piped input (${lines.length} lines, about ${tokens} tokens) is stored as result ${handle}.`,
    `First lines:`,
    preview,
    `Read more with read_result and handle ${handle}.`,
  ].join("\n");
}
