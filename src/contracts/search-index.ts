// Managing the semantic search indexes (seam: cli → the semantic part). SRCH-9.
// Indexing is a user command (`clankr index`, `/index`), never a model tool.

export type IndexRequest =
  /** List the indexed folders with their counts and age. */
  | { action: "status" }
  /** Index a folder, or bring its index up to date. `rebuild` starts from nothing. */
  | { action: "build"; folder: string; rebuild: boolean }
  /** Delete a folder's index. */
  | { action: "remove"; folder: string };

/** How far an indexing run is. Only new and changed files are counted; the rest are skipped. */
export interface IndexProgress {
  filesDone: number;
  filesTotal: number;
  /** The file just stored, relative to the indexed folder. */
  path: string;
}

export type IndexOutcome = "done" | "failed" | "cancelled";

/** What the caller supplies to run one request. */
export interface IndexRunOptions {
  /** Aborting stops an indexing run between files; what was stored is kept. */
  signal: AbortSignal;
  /** Results and problems, a line or a short block at a time. */
  print(text: string): void;
  showProgress(progress: IndexProgress): void;
}
