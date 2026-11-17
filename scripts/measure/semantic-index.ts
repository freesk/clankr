// Measures indexing and query speed of the semantic index (SRCH-9) on a synthetic corpus,
// with deterministic dense fake vectors of the real size (768 numbers, like nomic-embed-text-v1.5).
// It times everything clankr does itself (walk, path policy, reading, chunking, DuckDB writes,
// brute-force cosine search) and leaves out the one thing it cannot: the embedding model.
// Nothing touches the real ~/.clankr or LM Studio.
//
// Usage: node --no-node-snapshot scripts/measure/semantic-index.ts [files] [passages-per-file]

import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPathPolicy } from "../../src/app/path-policy.ts";
import { defaultConfig } from "../../src/config/index.ts";
import type { IndexRequest, ToolContext } from "../../src/contracts/index.ts";
import { indexFileFor } from "../../src/semantic/index-location.ts";
import { runIndexRequest } from "../../src/semantic/index-requests.ts";
import { createSearchMeaningTool } from "../../src/semantic/search-meaning-tool.ts";
import { buildRootPaths } from "../../src/storage/index.ts";
import { createTestToolContext, ScriptedLmClient } from "../../src/testing/index.ts";

const fileCount = Number(process.argv[2] ?? 2_000);
const passagesPerFile = Number(process.argv[3] ?? 10);
const vectorSize = 768;
const queryRuns = 20;

const config = defaultConfig();
const scratch = await realpath(await mkdtemp(join(tmpdir(), "clankr-measure-semantic-")));
const documents = join(scratch, "documents");
const clankrRoot = join(scratch, "clankr-home");
const indexDirectory = buildRootPaths(clankrRoot).indexDirectory;
const lm = new ScriptedLmClient();
// Dense vectors, like a real model's: the bag-of-words fake is mostly zeros, which DuckDB
// compresses and compares far faster than real embeddings.
lm.embed = async (request) => request.inputs.map(denseVector);
const paths = createPathPolicy(config, { clankrRoot, workingDirectory: documents });

/** A small generator, so the corpus is the same on every run. */
function randomSource(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

/** The same text always gets the same vector; every number is between -0.5 and 0.5. */
function denseVector(text: string): number[] {
  let seed = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 7) {
    seed = Math.imul(seed ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  const random = randomSource(seed);
  return Array.from({ length: vectorSize }, () => random() - 0.5);
}

const vocabulary = Array.from({ length: 3_000 }, (_, index) => `word${index}`);

/** Lines of about 80 characters; `passages` passages of the configured size in all. */
function documentText(fileNumber: number, passages: number): string {
  const random = randomSource(fileNumber + 1);
  const characters =
    passages * (config.search.indexChunkCharacters - config.search.indexChunkOverlap);
  const lines: string[] = [];
  let length = 0;
  while (length < characters) {
    const words = Array.from(
      { length: 11 },
      () => vocabulary[Math.floor(random() * vocabulary.length)],
    );
    const line = words.join(" ");
    lines.push(line);
    length += line.length + 1;
  }
  return `${lines.join("\n")}\n`;
}

async function writeCorpus(): Promise<void> {
  for (let fileNumber = 0; fileNumber < fileCount; fileNumber++) {
    const folder = join(documents, `folder-${String(fileNumber % 50).padStart(2, "0")}`);
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, `note-${fileNumber}.md`),
      documentText(fileNumber, passagesPerFile),
    );
  }
}

async function timed<Value>(work: () => Promise<Value>): Promise<{ value: Value; ms: number }> {
  const started = performance.now();
  const value = await work();
  return { value, ms: Math.round(performance.now() - started) };
}

const printed: string[] = [];
function index(request: IndexRequest) {
  return runIndexRequest(request, {
    config,
    lm,
    paths,
    indexDirectory,
    signal: new AbortController().signal,
    print: (text) => printed.push(text),
    showProgress: () => {},
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

try {
  await mkdir(documents, { recursive: true });
  const corpus = await timed(writeCorpus);
  console.log(`corpus: ${fileCount} files written in ${corpus.ms} ms`);

  const build: IndexRequest = { action: "build", folder: documents, rebuild: false };
  const first = await timed(() => index(build));
  console.log(`first index: ${first.ms} ms (${first.value})`);
  console.log(`  ${printed.at(-1)?.replaceAll("\n", "\n  ")}`);
  const indexFile = indexFileFor(indexDirectory, documents);
  const megabytes = ((await stat(indexFile)).size / 1_000_000).toFixed(1);
  console.log(`index file: ${megabytes} MB`);

  const unchanged = await timed(() => index(build));
  console.log(`re-run with nothing changed: ${unchanged.ms} ms`);

  for (let fileNumber = 0; fileNumber < 20; fileNumber++) {
    const path = join(
      documents,
      `folder-${String(fileNumber).padStart(2, "0")}`,
      `note-${fileNumber}.md`,
    );
    await writeFile(path, documentText(fileNumber + 100_000, passagesPerFile));
  }
  const incremental = await timed(() => index(build));
  console.log(`re-run with 20 files changed: ${incremental.ms} ms`);

  const toolContext = await createTestToolContext({ workingDirectory: documents });
  const context: ToolContext = {
    ...toolContext.context,
    config,
    lm,
    paths,
    clankrPaths: { ...toolContext.context.clankrPaths, indexDirectory },
  };
  const tool = createSearchMeaningTool(config);
  const queryTimes: number[] = [];
  for (let run = 0; run < queryRuns; run++) {
    const query = `word${run * 7} word${run * 13 + 1} word${run * 31 + 2}`;
    const { ms } = await timed(() => tool.run({ query }, context));
    queryTimes.push(ms);
  }
  console.log(
    `search_meaning over the index: first ${queryTimes[0]} ms, median ${median(queryTimes.slice(1))} ms, slowest after the first ${Math.max(...queryTimes.slice(1))} ms (${queryRuns} queries)`,
  );
  await toolContext.cleanup();
} finally {
  await rm(scratch, { recursive: true, force: true });
}
