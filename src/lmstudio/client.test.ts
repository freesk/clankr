import { afterEach, describe, expect, it } from "vitest";
import type { ChatEvent, ChatMessage } from "../contracts/index.ts";
import { LmStudioClient } from "./client.ts";
import {
  configForServer,
  FakeLmStudioServer,
  type FakeServerOptions,
} from "./fake-lm-studio-server.test-support.ts";
import type { TokenCounter } from "./token-counter.ts";

const servers: FakeLmStudioServer[] = [];
const clients: LmStudioClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.dispose()));
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

/** A counter that never touches the SDK: the message count times ten. */
const fixedCounter: TokenCounter = {
  count: async (messages) => messages.length * 10,
  dispose: async () => {},
};

async function startClient(
  options: FakeServerOptions,
  extra: { tokenCounter?: TokenCounter; warnings?: string[] } = {},
) {
  const server = new FakeLmStudioServer(options);
  servers.push(server);
  const baseUrl = await server.start();
  const client = new LmStudioClient({
    config: configForServer(baseUrl, {
      model: { profiles: { "test/a": { temperature: 0.3, topK: 40 } } },
    }),
    tokenCounter: extra.tokenCounter ?? fixedCounter,
    onWarning: (text) => extra.warnings?.push(text),
  });
  clients.push(client);
  return { server, client };
}

async function collect(events: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const collected: ChatEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

describe("listModels", () => {
  it("maps the MOD-3 fields", async () => {
    const { client } = await startClient({
      models: [
        { key: "test/a", vision: true, maxContextLength: 32_768, loadedContextLengths: [8_192] },
        { key: "test/embed", type: "embedding" },
      ],
    });
    const models = await client.listModels();
    expect(models).toHaveLength(2);
    expect(models[0]).toEqual({
      key: "test/a",
      displayName: "TEST/A",
      type: "llm",
      parameterSize: "4B",
      quantization: "Q4_K_M",
      maxContextLength: 32_768,
      capabilities: { vision: true, trainedForToolUse: true, reasoning: false },
      loadedInstances: [{ instanceId: "test/a", contextLength: 8_192 }],
    });
    expect(models[1]?.type).toBe("embedding");
  });
});

describe("loadModel", () => {
  it("loads a model that is not loaded with the requested context length", async () => {
    const { server, client } = await startClient({ models: [{ key: "test/a" }] });
    const loaded = await client.loadModel("test/a", { contextLength: 16_384 });
    expect(loaded.contextLength).toBe(16_384);
    expect(server.loadedContextLengths("test/a")).toEqual([16_384]);
  });

  it("reuses an instance already loaded with the same context length", async () => {
    const { server, client } = await startClient({
      models: [{ key: "test/a", loadedContextLengths: [16_384] }],
    });
    const loaded = await client.loadModel("test/a", { contextLength: 16_384 });
    expect(loaded.instanceId).toBe("test/a");
    expect(server.requests.some((request) => request.path.endsWith("/load"))).toBe(false);
  });

  it("reloads a model loaded with a different context length (D22)", async () => {
    const { server, client } = await startClient({
      models: [{ key: "test/a", loadedContextLengths: [4_096] }],
    });
    const loaded = await client.loadModel("test/a", { contextLength: 16_384 });
    expect(loaded.contextLength).toBe(16_384);
    expect(server.loadedContextLengths("test/a")).toEqual([16_384]);
    const paths = server.requests.map((request) => request.path);
    expect(paths.indexOf("/api/v1/models/unload")).toBeLessThan(
      paths.indexOf("/api/v1/models/load"),
    );
  });
});

const streamedReply = [
  { choices: [{ delta: { reasoning_content: "thinking" } }] },
  { choices: [{ delta: { content: "Hel" } }] },
  { choices: [{ delta: { content: "lo" } }] },
  {
    choices: [
      {
        delta: {
          tool_calls: [{ index: 0, id: "call_1", function: { name: "list_dir", arguments: "{" } }],
        },
      },
    ],
  },
  { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "}" } }] } }] },
  { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
];

const messages: ChatMessage[] = [
  { role: "system", content: "Be brief." },
  { role: "user", content: "Hi" },
];

describe("chat", () => {
  it("streams text, reasoning, tool-call deltas, usage, and done", async () => {
    const { client } = await startClient({
      chatChunks: [
        ...streamedReply,
        { choices: [], usage: { prompt_tokens: 12, completion_tokens: 5 } },
      ],
    });
    const events = await collect(
      client.chat({ model: "test/a", messages }, new AbortController().signal),
    );
    expect(events).toEqual([
      { type: "reasoning", delta: "thinking" },
      { type: "text", delta: "Hel" },
      { type: "text", delta: "lo" },
      { type: "tool-call-delta", index: 0, id: "call_1", name: "list_dir", argumentsDelta: "{" },
      { type: "tool-call-delta", index: 0, argumentsDelta: "}" },
      { type: "usage", usage: { promptTokens: 12, completionTokens: 5 } },
      { type: "done", finishReason: "tool_calls" },
    ]);
  });

  it("sends the wire format, usage request, reasoning setting, and profile sampling", async () => {
    const { server, client } = await startClient({ chatChunks: [] });
    const request = {
      model: "test/a",
      messages: [
        ...messages,
        {
          role: "assistant" as const,
          content: "",
          toolCalls: [{ id: "c1", name: "list_dir", argumentsJson: '{"path":"."}' }],
        },
        { role: "tool" as const, toolCallId: "c1", content: "a.txt" },
      ],
      tools: [{ name: "list_dir", description: "List.", parameters: { type: "object" } }],
      reasoning: "off" as const,
      sampling: { temperature: 0.7 },
    };
    await collect(client.chat(request, new AbortController().signal));
    const body = server.requests.find((r) => r.path === "/v1/chat/completions")?.body;
    expect(body).toMatchObject({
      model: "test/a",
      stream: true,
      stream_options: { include_usage: true },
      reasoning_effort: "none",
      temperature: 0.7,
      top_k: 40,
      tools: [{ type: "function", function: { name: "list_dir" } }],
    });
    expect((body as { messages: unknown[] }).messages.slice(2)).toEqual([
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "list_dir", arguments: '{"path":"."}' } },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "a.txt" },
    ]);
  });

  it("counts tokens itself when the stream reports no usage", async () => {
    const { client } = await startClient({ chatChunks: streamedReply });
    const events = await collect(
      client.chat({ model: "test/a", messages }, new AbortController().signal),
    );
    const usage = events.find((event) => event.type === "usage");
    // No model is active, so the prompt is estimated: 11 characters is 3 tokens; "Hello" is 2.
    expect(usage).toEqual({ type: "usage", usage: { promptTokens: 3, completionTokens: 2 } });
    expect(events.at(-1)?.type).toBe("done");
  });

  it("closes the HTTP stream promptly when the signal aborts", async () => {
    const { server, client } = await startClient({
      chatChunks: [{ choices: [{ delta: { content: "partial" } }] }],
      holdChatOpen: true,
    });
    const controller = new AbortController();
    const events = client.chat({ model: "test/a", messages }, controller.signal);
    const iterator = events[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual({ type: "text", delta: "partial" });
    const pending = iterator.next();
    controller.abort();
    await expect(pending).rejects.toThrow();
    await expect(
      Promise.race([
        server.chatClosed.then(() => "closed"),
        new Promise((resolve) => setTimeout(() => resolve("still open"), 1_000)),
      ]),
    ).resolves.toBe("closed");
  });
});

describe("countTokens", () => {
  it("uses the tokenizer of the active model", async () => {
    const { client } = await startClient({ models: [{ key: "test/a" }] });
    await client.loadModel("test/a", { contextLength: 8_192 });
    expect(await client.countTokens(messages)).toBe(20);
  });

  it("falls back to an estimate and warns once when the tokenizer fails", async () => {
    const warnings: string[] = [];
    const failing: TokenCounter = {
      count: async () => {
        throw new Error("socket closed");
      },
      dispose: async () => {},
    };
    const { client } = await startClient(
      { models: [{ key: "test/a" }] },
      { tokenCounter: failing, warnings },
    );
    await client.loadModel("test/a", { contextLength: 8_192 });
    expect(await client.countTokens(messages)).toBe(3);
    expect(await client.countTokens(messages)).toBe(3);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("estimated");
  });
});
