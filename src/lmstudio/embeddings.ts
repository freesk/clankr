// LM Studio's OpenAI-compatible embeddings endpoint, `POST /v1/embeddings` (SRCH-9). It goes
// through the same transport as everything else, so the loopback rule (SEC-1) and the token
// header (MOD-2) apply, and no other code opens a connection to embed text.

import { z } from "zod";
import type { EmbeddingRequest } from "../contracts/index.ts";
import { embeddingFailed, embeddingModelNotDownloaded } from "./errors.ts";
import { fetchModels } from "./models-api.ts";
import type { LmStudioTransport } from "./transport.ts";

const embeddingsResponseSchema = z.object({
  data: z.array(
    z.object({
      /** Position of the input this vector belongs to. Servers may answer out of order. */
      index: z.number().int().nonnegative().optional(),
      embedding: z.array(z.number()),
    }),
  ),
});

/** One vector per input, in input order. */
export async function requestEmbeddings(
  transport: LmStudioTransport,
  request: EmbeddingRequest,
  signal: AbortSignal,
): Promise<number[][]> {
  if (request.inputs.length === 0) return [];
  const body = await transport.postJson(
    "/v1/embeddings",
    { model: request.model, input: request.inputs },
    {
      what: "embedding text",
      signal,
      onHttpError: (_status, detail) => embeddingFailed(request.model, detail),
    },
  );
  const parsed = embeddingsResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw embeddingFailed(request.model, "LM Studio returned an unexpected response");
  }
  const vectors = inInputOrder(parsed.data.data);
  if (!isCompleteAnswer(vectors, request.inputs.length)) {
    throw embeddingFailed(
      request.model,
      `expected ${request.inputs.length} vectors of one size, got ${vectors.length}`,
    );
  }
  return vectors;
}

/** The MOD-8 style check: a model that is not downloaded fails with its fix, before any request. */
export async function assertEmbeddingModelDownloaded(
  transport: LmStudioTransport,
  key: string,
): Promise<void> {
  const embeddingKeys = (await fetchModels(transport))
    .filter((model) => model.type === "embedding")
    .map((model) => model.key);
  if (!embeddingKeys.includes(key)) throw embeddingModelNotDownloaded(key, embeddingKeys);
}

function inInputOrder(entries: { index?: number | undefined; embedding: number[] }[]): number[][] {
  return entries
    .map((entry, position) => ({ position: entry.index ?? position, vector: entry.embedding }))
    .sort((a, b) => a.position - b.position)
    .map((entry) => entry.vector);
}

function isCompleteAnswer(vectors: number[][], expectedCount: number): boolean {
  if (vectors.length !== expectedCount) return false;
  const size = vectors[0]?.length ?? 0;
  return size > 0 && vectors.every((vector) => vector.length === size);
}
