import { afterEach, describe, expect, it } from "vitest";
import { fakeEmbedding } from "../testing/index.ts";
import { LmStudioClient } from "./client.ts";
import { LmStudioError } from "./errors.ts";
import {
  configForServer,
  FakeLmStudioServer,
  type FakeServerOptions,
} from "./fake-lm-studio-server.test-support.ts";

const servers: FakeLmStudioServer[] = [];
const clients: LmStudioClient[] = [];
const embeddingModel = "test/embed";
const secretToken = "sk-lm-test-token-12345";

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.dispose()));
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

async function startClient(options: FakeServerOptions = {}, apiToken?: string) {
  const server = new FakeLmStudioServer({
    models: [{ key: "test/a" }, { key: embeddingModel, type: "embedding" }],
    ...options,
  });
  servers.push(server);
  const baseUrl = await server.start();
  const client = new LmStudioClient({
    config: configForServer(baseUrl, apiToken ? { lmStudio: { apiToken } } : {}),
    tokenCounter: { count: async () => 0, dispose: async () => {} },
  });
  clients.push(client);
  return { server, client };
}

const neverAborted = () => new AbortController().signal;

describe("embed", () => {
  it("posts the inputs to /v1/embeddings with the token and returns one vector each", async () => {
    const { server, client } = await startClient({ requiredToken: secretToken }, secretToken);

    const vectors = await client.embed(
      { model: embeddingModel, inputs: ["first passage", "second one"] },
      neverAborted(),
    );

    expect(vectors).toEqual([fakeEmbedding("first passage"), fakeEmbedding("second one")]);
    const request = server.requests.find((recorded) => recorded.path === "/v1/embeddings");
    expect(request).toMatchObject({
      method: "POST",
      authorization: `Bearer ${secretToken}`,
      body: { model: embeddingModel, input: ["first passage", "second one"] },
    });
  });

  it("checks the model against the downloaded ones once, not on every call", async () => {
    const { server, client } = await startClient();
    await client.embed({ model: embeddingModel, inputs: ["a"] }, neverAborted());
    await client.embed({ model: embeddingModel, inputs: ["b"] }, neverAborted());
    const listings = server.requests.filter((recorded) => recorded.path === "/api/v1/models");
    expect(listings).toHaveLength(1);
  });

  it("fails with a fix when the embedding model is not downloaded (MOD-8 style)", async () => {
    const { server, client } = await startClient();

    const failure = await client
      .embed({ model: "missing/embedder", inputs: ["a"] }, neverAborted())
      .catch((error) => error);

    expect(failure).toBeInstanceOf(LmStudioError);
    expect(failure.kind).toBe("model-not-downloaded");
    expect(failure.message).toBe(
      'The embedding model "missing/embedder" is not downloaded in LM Studio. Downloaded embedding models: test/embed.',
    );
    expect(failure.fix).toMatch(/lms get missing\/embedder.*search\.embeddingModel/);
    expect(server.requests.some((recorded) => recorded.path === "/v1/embeddings")).toBe(false);
  });

  it("does not accept a chat model as an embedding model", async () => {
    const { client } = await startClient();
    await expect(client.embed({ model: "test/a", inputs: ["a"] }, neverAborted())).rejects.toThrow(
      /"test\/a" is not downloaded/,
    );
  });

  it("reports a server failure with the model name and never the token", async () => {
    const { client } = await startClient(
      { requiredToken: secretToken, failingEmbeddings: `model crashed (${secretToken})` },
      secretToken,
    );

    const failure = await client
      .embed({ model: embeddingModel, inputs: ["a"] }, neverAborted())
      .catch((error) => error);

    expect(failure).toBeInstanceOf(LmStudioError);
    expect(failure.describe()).toMatch(/could not embed text with "test\/embed": model crashed/);
    expect(failure.describe()).not.toContain(secretToken);
  });

  it("rejects an answer with a missing vector", async () => {
    const { client } = await startClient({ embeddingDimensions: 0 });
    await expect(
      client.embed({ model: embeddingModel, inputs: ["a"] }, neverAborted()),
    ).rejects.toThrow(/expected 1 vectors of one size/);
  });

  it("refuses a host that is not loopback (SEC-1)", async () => {
    const client = new LmStudioClient({
      config: configForServer("http://models.example.com:1234"),
      resolveHost: async () => ["203.0.113.7"],
      tokenCounter: { count: async () => 0, dispose: async () => {} },
    });
    clients.push(client);
    const failure = await client
      .embed({ model: embeddingModel, inputs: ["a"] }, neverAborted())
      .catch((error) => error);
    expect(failure).toBeInstanceOf(LmStudioError);
    expect(failure.kind).toBe("host-not-allowed");
  });

  it("stops when the signal is aborted", async () => {
    const { client } = await startClient();
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.embed({ model: embeddingModel, inputs: ["a"] }, controller.signal),
    ).rejects.toThrow();
  });
});
