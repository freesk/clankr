// Text extraction for the semantic index (SRCH-9): one small interface, one implementation
// per file kind. The indexer only ever sees segments of plain text.

import { extensionOf, kindExtensions } from "../../tools/search/file-kinds.ts";

/** A stretch of a file's text. A PDF gives one per page; every other file gives one. */
export interface TextSegment {
  text: string;
  /** 1-based page number, for PDFs. */
  page?: number;
}

/** Text, or the reason this file has none worth indexing (shown in the indexing summary). */
export type Extraction = { segments: TextSegment[] } | { skipped: string };

export interface ExtractionOptions {
  /** The indexing run's signal: aborting it stops a running extraction. */
  signal: AbortSignal;
  /** How long one file may take. */
  timeoutMs: number;
}

export type TextExtractor = (path: string, options: ExtractionOptions) => Promise<Extraction>;

/** How a file's text is read. Files of no kind listed here are never opened. */
export type IndexableKind = "text" | "document" | "pdf";

/** The formats macOS `textutil` converts to plain text. */
export const wordLikeExtensions: readonly string[] = ["docx", "doc", "rtf", "odt"];

/**
 * Formats that are never text. Spreadsheets are left to the data tools, which read them far
 * better than a text index would; the rest have no text to read.
 */
const neverIndexedExtensions = new Set<string>([
  ...kindExtensions.image,
  ...kindExtensions.audio,
  ...kindExtensions.video,
  ...kindExtensions.archive,
  ...kindExtensions.spreadsheet,
  ...kindExtensions.presentation,
  "pages",
]);

/** Decided by name alone, so a folder of photos costs no file opens. */
export function indexableKindOf(fileName: string): IndexableKind | undefined {
  const extension = extensionOf(fileName);
  if (extension === "pdf") return "pdf";
  if (wordLikeExtensions.includes(extension)) return "document";
  if (neverIndexedExtensions.has(extension)) return undefined;
  return "text";
}

/**
 * An extraction's own time limit combined with the run's signal. `timedOut` tells the two
 * apart afterwards: a cancelled run is rethrown, a slow file is only skipped.
 */
export function extractionSignal(options: ExtractionOptions): {
  signal: AbortSignal;
  timedOut(): boolean;
} {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  return {
    signal: AbortSignal.any([options.signal, timeout]),
    timedOut: () => timeout.aborted && !options.signal.aborted,
  };
}
