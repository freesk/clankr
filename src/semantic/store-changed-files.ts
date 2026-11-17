// The working part of an indexing run: read each new or changed file, cut it into passages,
// embed them, and store the file. Files are read one by one, but their passages are embedded
// together, a batch at a time, so a folder of small notes costs one request per batch and
// not one per file.

import type { Config, IndexProgress } from "../contracts/index.ts";
import type { CandidateFile } from "./candidates.ts";
import { type Chunk, chunkSegments } from "./chunking.ts";
import type { Embedder } from "./embedder.ts";
import { defaultExtractors, type Extraction, type Extractors } from "./extract/index.ts";
import type { IndexedFile, IndexStore } from "./index-store.ts";

/** What this run did to the files it read. */
export interface RunTally {
  /** Files that now have passages. */
  indexed: number;
  passagesWritten: number;
  /** Files without passages, by reason. */
  skipped: Map<string, number>;
  cancelled: boolean;
}

export interface FileRun {
  store: IndexStore;
  embedder: Embedder;
  config: Config;
  /** Checked between files; aborting also stops a running extraction or request. */
  signal: AbortSignal;
  onProgress?(progress: IndexProgress): void;
  /** Replaces the real extractors in tests. */
  extractors?: Extractors;
  /** What the index held before the run, by relative path. */
  indexedByPath: Map<string, IndexedFile>;
  tally: RunTally;
}

/** A file read and cut into passages, waiting for its vectors. */
interface PreparedFile {
  file: CandidateFile;
  previous: IndexedFile | undefined;
  chunks: Chunk[];
  /** Why there are no passages, when there are none. */
  note?: string;
}

export async function storeChangedFiles(run: FileRun, changed: CandidateFile[]): Promise<void> {
  let waiting: PreparedFile[] = [];
  let filesDone = 0;

  const storeWaiting = async (): Promise<void> => {
    const texts = waiting.flatMap((prepared) => prepared.chunks.map((chunk) => chunk.text));
    const vectors = await run.embedder.embedDocuments(texts, run.signal);
    let offset = 0;
    for (const prepared of waiting) {
      const fileVectors = vectors.slice(offset, offset + prepared.chunks.length);
      offset += prepared.chunks.length;
      await storeFile(run, prepared, fileVectors);
      filesDone += 1;
      run.onProgress?.({
        filesDone,
        filesTotal: changed.length,
        path: prepared.file.relativePath,
      });
    }
    waiting = [];
  };

  for (const file of changed) {
    run.signal.throwIfAborted();
    waiting.push(await prepareFile(run, file));
    const waitingPassages = waiting.reduce((sum, prepared) => sum + prepared.chunks.length, 0);
    if (waitingPassages >= run.config.search.embeddingBatchSize) await storeWaiting();
  }
  await storeWaiting();
}

async function prepareFile(run: FileRun, file: CandidateFile): Promise<PreparedFile> {
  const settings = run.config.search;
  const previous = run.indexedByPath.get(file.relativePath);
  const extraction = await extractText(run, file);
  if ("skipped" in extraction) return { file, previous, chunks: [], note: extraction.skipped };
  const chunks = chunkSegments(extraction.segments, {
    chunkCharacters: settings.indexChunkCharacters,
    overlapCharacters: settings.indexChunkOverlap,
  });
  if (chunks.length === 0) return { file, previous, chunks, note: "no text" };
  return { file, previous, chunks };
}

/** One unreadable file is skipped with a reason; it never stops the run. */
async function extractText(run: FileRun, file: CandidateFile): Promise<Extraction> {
  const extract = (run.extractors ?? defaultExtractors)[file.kind];
  try {
    return await extract(file.path, {
      signal: run.signal,
      timeoutMs: run.config.search.indexExtractTimeoutMs,
    });
  } catch (error) {
    if (run.signal.aborted) throw error;
    return { skipped: "could not be read" };
  }
}

/** A file with a note is stored too, so the next run does not read it again while unchanged. */
async function storeFile(run: FileRun, prepared: PreparedFile, vectors: number[][]): Promise<void> {
  const { file, chunks, note } = prepared;
  await run.store.replaceFile(
    {
      path: file.relativePath,
      sizeBytes: file.sizeBytes,
      modifiedMs: file.modifiedMs,
      ...(note === undefined ? {} : { note }),
    },
    chunks,
    vectors,
    prepared.previous?.fileId,
  );
  if (note === undefined) {
    run.tally.indexed += 1;
    run.tally.passagesWritten += chunks.length;
  } else {
    run.tally.skipped.set(note, (run.tally.skipped.get(note) ?? 0) + 1);
  }
}
