// Builds or updates one folder's index (SRCH-9). A run is incremental: a file whose size
// and modified time match what the index recorded is left alone, a new or changed file is
// read, cut into passages, embedded, and stored, and a file that is gone is dropped.
//
// Cancelling (Ctrl+C) stops between files. Every file is stored in one transaction, so the
// index stays consistent and the next run picks up where this one stopped.

import { access } from "node:fs/promises";
import { join } from "node:path";
import type { Config, IndexProgress, LmClient, PathPolicy } from "../contracts/index.ts";
import { type CandidateFile, findCandidates } from "./candidates.ts";
import { Embedder } from "./embedder.ts";
import { dimensionMismatch, indexInUse, modelMismatch, unreadableIndex } from "./errors.ts";
import type { Extractors } from "./extract/index.ts";
import { isLockConflict } from "./index-database.ts";
import { deleteIndexFile, indexFileFor } from "./index-location.ts";
import { type IndexedFile, IndexStore } from "./index-store.ts";
import { type RunTally, storeChangedFiles } from "./store-changed-files.ts";

export interface BuildRequest {
  /** Real path of an existing folder that the path policy does not deny. */
  root: string;
  indexDirectory: string;
  config: Config;
  lm: LmClient;
  paths: PathPolicy;
  signal: AbortSignal;
  /** Throw the existing index away first, for a changed embedding model. */
  rebuild?: boolean;
  onProgress?(progress: IndexProgress): void;
  /** Replaces the real extractors in tests. */
  extractors?: Extractors;
  now?(): Date;
}

export interface BuildSummary {
  root: string;
  /** New or changed files that now have passages. */
  indexed: number;
  unchanged: number;
  /** Files dropped from the index: deleted, protected, or no longer indexable. */
  removed: number;
  /** Files without passages, by reason: left out before reading, or read and found empty. */
  skipped: [reason: string, count: number][];
  passagesWritten: number;
  cancelled: boolean;
  /** What the index holds after the run. */
  totalFiles: number;
  totalPassages: number;
  elapsedMs: number;
}

interface RunOutcome {
  tally: RunTally;
  unchanged: number;
  removed: number;
}

export async function buildIndex(request: BuildRequest): Promise<BuildSummary> {
  const started = performance.now();
  const embedder = new Embedder(request.lm, request.config);
  // Asked first: a missing model or a stopped LM Studio fails here, before anything changes.
  const vectorSize = await embedder.vectorSize(request.signal);
  const indexFile = indexFileFor(request.indexDirectory, request.root);
  if (request.rebuild) await discardIndex(indexFile, request.root);

  const store = await openForWriting(indexFile, request.root);
  try {
    await prepareStore(store, request, embedder.model, vectorSize);
    const outcome = await updateIndex(store, request, embedder);
    await store.finishRun(!outcome.tally.cancelled, (request.now ?? (() => new Date()))());
    const totals = await store.counts();
    return {
      root: request.root,
      indexed: outcome.tally.indexed,
      unchanged: outcome.unchanged,
      removed: outcome.removed,
      skipped: [...outcome.tally.skipped.entries()].sort(([a], [b]) => a.localeCompare(b)),
      passagesWritten: outcome.tally.passagesWritten,
      cancelled: outcome.tally.cancelled,
      totalFiles: totals.files,
      totalPassages: totals.chunks,
      elapsedMs: Math.round(performance.now() - started),
    };
  } finally {
    await store.close();
  }
}

async function openForWriting(indexFile: string, root: string): Promise<IndexStore> {
  try {
    return await IndexStore.open(indexFile, "write");
  } catch (error) {
    throw isLockConflict(error) ? indexInUse(root) : unreadableIndex(root, error);
  }
}

/**
 * Deletes the index for a rebuild, unless another process is using it. A file that cannot
 * be opened for any other reason is deleted all the same: a rebuild is the fix for it.
 */
async function discardIndex(indexFile: string, root: string): Promise<void> {
  try {
    await (await IndexStore.open(indexFile, "write")).close();
  } catch (error) {
    if (isLockConflict(error)) throw indexInUse(root);
  }
  await deleteIndexFile(indexFile);
}

/** A new index is initialized; an existing one must match the configured embedding model. */
async function prepareStore(
  store: IndexStore,
  request: BuildRequest,
  model: string,
  vectorSize: number,
): Promise<void> {
  const meta = await store.readMeta();
  if (!meta) return store.initialize(request.root, model);
  if (meta.embeddingModel !== model) throw modelMismatch(request.root, meta.embeddingModel, model);
  if (meta.dimensions !== undefined && meta.dimensions !== vectorSize) {
    throw dimensionMismatch(request.root, meta.dimensions, vectorSize);
  }
}

async function updateIndex(
  store: IndexStore,
  request: BuildRequest,
  embedder: Embedder,
): Promise<RunOutcome> {
  const tally: RunTally = { indexed: 0, passagesWritten: 0, skipped: new Map(), cancelled: false };
  const outcome: RunOutcome = { tally, unchanged: 0, removed: 0 };
  try {
    const scan = await findCandidates(request);
    for (const [reason, count] of scan.leftOut) tally.skipped.set(reason, count);
    const indexedByPath = new Map((await store.listFiles()).map((file) => [file.path, file]));

    const gone = await filesToDrop(request.root, indexedByPath, scan.files, scan.walkComplete);
    await store.removeFiles(gone.map((file) => file.fileId));
    outcome.removed = gone.length;

    const changed = scan.files.filter(
      (file) => !isUnchanged(file, indexedByPath.get(file.relativePath)),
    );
    outcome.unchanged = scan.files.length - changed.length;
    await storeChangedFiles(
      {
        store,
        embedder,
        config: request.config,
        signal: request.signal,
        indexedByPath,
        tally,
        ...(request.onProgress ? { onProgress: request.onProgress } : {}),
        ...(request.extractors ? { extractors: request.extractors } : {}),
      },
      changed,
    );
  } catch (error) {
    // A cancelled run is an outcome, not a failure: what was stored so far is kept.
    if (!request.signal.aborted) throw error;
    tally.cancelled = true;
  }
  return outcome;
}

function isUnchanged(file: CandidateFile, indexed: IndexedFile | undefined): boolean {
  return indexed?.sizeBytes === file.sizeBytes && indexed.modifiedMs === file.modifiedMs;
}

/**
 * Indexed files that are no longer candidates: deleted, now protected, now too large. After
 * a walk that stopped early, a file it never reached is kept unless it is really gone.
 */
async function filesToDrop(
  root: string,
  indexedByPath: Map<string, IndexedFile>,
  candidates: CandidateFile[],
  walkComplete: boolean,
): Promise<IndexedFile[]> {
  const candidatePaths = new Set(candidates.map((file) => file.relativePath));
  const notSeen = [...indexedByPath.values()].filter((file) => !candidatePaths.has(file.path));
  if (walkComplete) return notSeen;
  const dropped: IndexedFile[] = [];
  for (const file of notSeen) {
    const exists = await access(join(root, file.path)).then(
      () => true,
      () => false,
    );
    if (!exists) dropped.push(file);
  }
  return dropped;
}
