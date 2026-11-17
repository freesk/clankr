// Turns passages and queries into vectors with the configured embedding model. The only
// place that knows the task prefixes: nomic models are trained to see "search_document: "
// before a stored passage and "search_query: " before a question (both config values).

import type { Config, LmClient } from "../contracts/index.ts";

export class Embedder {
  readonly model: string;
  private readonly lm: LmClient;
  private readonly settings: Config["search"];

  constructor(lm: LmClient, config: Config) {
    this.lm = lm;
    this.settings = config.search;
    this.model = config.search.embeddingModel;
  }

  /** One vector per passage, in order, requested from LM Studio a batch at a time. */
  async embedDocuments(texts: readonly string[], signal: AbortSignal): Promise<number[][]> {
    const vectors: number[][] = [];
    const batchSize = this.settings.embeddingBatchSize;
    for (let start = 0; start < texts.length; start += batchSize) {
      signal.throwIfAborted();
      const batch = texts.slice(start, start + batchSize);
      vectors.push(...(await this.embed(batch, this.settings.embeddingDocumentPrefix, signal)));
    }
    return vectors;
  }

  async embedQuery(text: string, signal: AbortSignal): Promise<number[]> {
    const [vector] = await this.embed([text], this.settings.embeddingQueryPrefix, signal);
    return vector as number[];
  }

  /**
   * The size of the model's vectors, from one tiny request. Asked before a run starts, so a
   * model that is missing or will not load fails at once and not after walking the folder.
   */
  async vectorSize(signal: AbortSignal): Promise<number> {
    const [vector] = await this.embedDocuments(["clankr"], signal);
    return (vector as number[]).length;
  }

  private embed(texts: string[], prefix: string, signal: AbortSignal): Promise<number[][]> {
    const inputs = texts.map((text) => `${prefix}${text}`);
    return this.lm.embed({ model: this.model, inputs }, signal);
  }
}
