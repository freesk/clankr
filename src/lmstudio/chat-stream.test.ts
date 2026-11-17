import { describe, expect, it } from "vitest";
import type { ChatEvent } from "../contracts/index.ts";
import { parseChatStream } from "./chat-stream.ts";

function sseStream(chunks: unknown[]): ReadableStream<Uint8Array> {
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body).body as ReadableStream<Uint8Array>;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of parseChatStream(stream)) events.push(event);
  return events;
}

describe("parseChatStream", () => {
  it("drops Gemma 4's channel markers from reasoning text", async () => {
    const events = await collect(
      sseStream([
        { choices: [{ delta: { reasoning_content: "<|channel>thought" } }] },
        { choices: [{ delta: { reasoning_content: "\nThe file failed." } }] },
        { choices: [{ delta: { reasoning_content: "<channel|>" } }] },
        { choices: [{ delta: { content: "Done." }, finish_reason: "stop" }] },
      ]),
    );
    const reasoning = events
      .filter((event) => event.type === "reasoning")
      .map((event) => (event.type === "reasoning" ? event.delta : ""))
      .join("");
    expect(reasoning).toBe("\nThe file failed.");
    expect(events).toContainEqual({ type: "text", delta: "Done." });
  });
});
