// Tests against a running LM Studio. Skipped unless VIX_LIVE_LMSTUDIO=1 and LM_API_TOKEN are set,
// so the default suite runs without LM Studio. VIX_LIVE_LOAD=1 adds the load test, which reloads
// the model with another context length and then restores the length it had before.
// Uses google/gemma-4-e4b until the target 12B is downloaded (specs/lmstudio.md).

import { afterAll, describe, expect, it } from "vitest";
import type { ChatEvent, LoadedInstance } from "../contracts/index.ts";
import { parseChatStream } from "./chat-stream.ts";
import { LmStudioClient } from "./client.ts";
import { configForServer } from "./fake-lm-studio-server.ts";

const liveEnabled = process.env.VIX_LIVE_LMSTUDIO === "1" && Boolean(process.env.LM_API_TOKEN);
const loadEnabled = liveEnabled && process.env.VIX_LIVE_LOAD === "1";
const modelKey = process.env.VIX_LIVE_MODEL ?? "google/gemma-4-e4b";

function liveClient(onWarning: (text: string) => void = console.warn): LmStudioClient {
  const config = configForServer(process.env.VIX_LIVE_BASE_URL ?? "http://localhost:1234", {
    lmStudio: { apiToken: process.env.LM_API_TOKEN },
  });
  return new LmStudioClient({ config, onWarning });
}

async function loadedInstance(client: LmStudioClient): Promise<LoadedInstance | undefined> {
  const models = await client.listModels();
  return models.find((model) => model.key === modelKey)?.loadedInstances[0];
}

describe.skipIf(!liveEnabled)("live LM Studio", () => {
  const client = liveEnabled ? liveClient() : undefined;
  afterAll(async () => client?.dispose());

  it("lists models with the MOD-3 fields", async () => {
    const models = (await client?.listModels()) ?? [];
    const target = models.find((model) => model.key === modelKey);
    console.info(JSON.stringify(models, null, 2));
    expect(target?.type).toBe("llm");
    expect(target?.maxContextLength).toBeGreaterThan(0);
  });

  it("streams a reply and reports whether the server sent usage", async () => {
    if (!client) return;
    const instance = await loadedInstance(client);
    expect(instance, `${modelKey} must be loaded for this test`).toBeDefined();
    const body = {
      model: instance?.instanceId,
      messages: [{ role: "user", content: "Reply with the single word: ready" }],
      max_tokens: 32,
      stream: true,
      stream_options: { include_usage: true },
    };
    const stream = await client.transport.postStream("/v1/chat/completions", body, {
      what: "live chat",
      signal: AbortSignal.timeout(60_000),
    });
    const events: ChatEvent[] = [];
    for await (const event of parseChatStream(stream)) events.push(event);
    const usage = events.find((event) => event.type === "usage");
    console.info(`Server-reported usage: ${JSON.stringify(usage ?? "none")}`);
    expect(events.some((event) => event.type === "text" || event.type === "reasoning")).toBe(true);
    expect(usage).toBeDefined();
  }, 90_000);

  it("counts tokens with the loaded model's tokenizer", async () => {
    const warnings: string[] = [];
    const counter = liveClient((text) => warnings.push(text));
    try {
      const instance = await loadedInstance(counter);
      if (!instance) throw new Error(`${modelKey} must be loaded for this test`);
      // Same context length as now, so this reuses the instance and changes nothing.
      await counter.loadModel(modelKey, { contextLength: instance.contextLength });
      const counted = await counter.countTokens([{ role: "user", content: "Hello there, model." }]);
      console.info(`Counted tokens: ${counted}`);
      expect(warnings).toEqual([]);
      expect(counted).toBeGreaterThan(3);
    } finally {
      await counter.dispose();
    }
  }, 60_000);
});

describe.skipIf(!loadEnabled)("live LM Studio model loading", () => {
  it("loads with a chosen context length, then restores the previous one", async () => {
    const client = liveClient();
    const before = await loadedInstance(client);
    const chosen = before?.contextLength === 8_192 ? 4_096 : 8_192;
    try {
      const loaded = await client.loadModel(modelKey, { contextLength: chosen });
      expect(loaded.contextLength).toBe(chosen);
      expect((await loadedInstance(client))?.contextLength).toBe(chosen);
    } finally {
      if (before) await client.loadModel(modelKey, { contextLength: before.contextLength });
      else await client.unloadModel((await loadedInstance(client))?.instanceId ?? modelKey);
      await client.dispose();
    }
    expect((await loadedInstance(liveClient()))?.contextLength).toBe(before?.contextLength);
  }, 300_000);
});
