// Semantic search against a running LM Studio with a real embedding model. Skipped unless
// CLANKR_LIVE_LMSTUDIO=1 and LM_API_TOKEN are set, like src/lmstudio/live.test.ts, so the
// default suite never needs LM Studio. The index is built in a temporary folder; the real
// ~/.clankr is not touched.
//
//   CLANKR_LIVE_LMSTUDIO=1 LM_API_TOKEN=… npx vitest run src/semantic/live.test.ts
//
// CLANKR_LIVE_EMBEDDING_MODEL overrides the model key (default: the configured default),
// CLANKR_LIVE_BASE_URL the server address.

import { afterAll, describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.ts";
import { LmStudioClient } from "../lmstudio/client.ts";
import { configForServer } from "../lmstudio/fake-lm-studio-server.test-support.ts";
import { createSearchMeaningTool } from "./search-meaning-tool.ts";
import { createIndexWorkspace, type IndexWorkspace } from "./test-support.ts";

const liveEnabled = process.env.CLANKR_LIVE_LMSTUDIO === "1" && Boolean(process.env.LM_API_TOKEN);
const embeddingModel =
  process.env.CLANKR_LIVE_EMBEDDING_MODEL ?? defaultConfig().search.embeddingModel;

function liveConfig() {
  return configForServer(process.env.CLANKR_LIVE_BASE_URL ?? "http://localhost:1234", {
    lmStudio: { apiToken: process.env.LM_API_TOKEN },
    search: { embeddingModel },
  });
}

function cosine(a: number[], b: number[]): number {
  const dot = a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
  const norm = (vector: number[]) =>
    Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return dot / (norm(a) * norm(b));
}

describe.skipIf(!liveEnabled)("live semantic search", () => {
  const config = liveEnabled ? liveConfig() : defaultConfig();
  const client = liveEnabled ? new LmStudioClient({ config, onWarning: console.warn }) : undefined;
  let workspace: IndexWorkspace | undefined;

  afterAll(async () => {
    await workspace?.cleanup();
    await client?.dispose();
  });

  it("finds the embedding model among the downloaded ones", async () => {
    const models = (await client?.listModels()) ?? [];
    const embeddingKeys = models.filter((model) => model.type === "embedding").map((m) => m.key);
    console.info(`Embedding models in LM Studio: ${JSON.stringify(embeddingKeys)}`);
    expect(embeddingKeys).toContain(embeddingModel);
  });

  it("embeds text, and related texts land closer together than unrelated ones", async () => {
    if (!client) return;
    const signal = AbortSignal.timeout(120_000);
    const [question] = await client.embed(
      { model: embeddingModel, inputs: ["search_query: ending the contract early"] },
      signal,
    );
    const [related, unrelated] = await client.embed(
      {
        model: embeddingModel,
        inputs: [
          "search_document: Either party may terminate this agreement before its term ends.",
          "search_document: Chop the onions and simmer the broth for an hour.",
        ],
      },
      signal,
    );
    if (!question || !related || !unrelated) throw new Error("missing vectors");
    console.info(
      `Vector size ${question.length}; related ${cosine(question, related).toFixed(3)}, unrelated ${cosine(question, unrelated).toFixed(3)}`,
    );
    expect(question.length).toBeGreaterThan(0);
    expect(cosine(question, related)).toBeGreaterThan(cosine(question, unrelated));
  }, 180_000);

  it("indexes a folder and answers a question whose words are not in the text", async () => {
    if (!client) return;
    workspace = await createIndexWorkspace();
    await workspace.write(
      "contracts/lease.md",
      "# Lease\n\nEither party may terminate this agreement before the end of its term by giving ninety days written notice.\n",
    );
    await workspace.write("kitchen/soup.md", "Chop the onions and simmer the broth for an hour.\n");
    await workspace.write("travel/packing.md", "Passport, charger, two shirts, rain jacket.\n");

    const started = performance.now();
    expect(await workspace.index({ config, lm: client })).toBe("done");
    console.info(`Indexed in ${Math.round(performance.now() - started)} ms`);
    console.info(workspace.printed.join("\n"));

    const output = await createSearchMeaningTool(config).run(
      { query: "ending the contract early" },
      workspace.toolContext({ config, lm: client }),
    );
    console.info(output.text);
    expect(output.text.split("\n")[1]).toMatch(/^contracts\/lease\.md/);
  }, 300_000);
});
