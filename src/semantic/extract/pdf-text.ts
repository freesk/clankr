// The text layer of a PDF, page by page, through `unpdf`: a pure-JavaScript build of PDF.js
// that runs in Node with no canvas, no worker thread, and nothing fetched (D92). It is loaded
// on first use, never at startup (CLAUDE.md rule 7). A scanned PDF has no text layer and is
// skipped; reading those needs OCR, which clankr does not do.

import { readFile } from "node:fs/promises";
import {
  type Extraction,
  extractionSignal,
  type TextExtractor,
  type TextSegment,
} from "./extractor.ts";

type PdfModule = typeof import("unpdf");

let loading: Promise<PdfModule> | undefined;

function loadPdfReader(): Promise<PdfModule> {
  loading ??= import("unpdf");
  return loading;
}

/**
 * Text only: no system fonts are looked up, no font is built for drawing, no generated code
 * is evaluated, and PDF.js prints no warnings into the terminal.
 */
const documentOptions = {
  useSystemFonts: false,
  disableFontFace: true,
  isEvalSupported: false,
  verbosity: 0,
};

export const extractPdfText: TextExtractor = async (path, options) => {
  const limit = extractionSignal(options);
  try {
    const data = await readFile(path, { signal: limit.signal });
    return await abortable(readPages(new Uint8Array(data)), limit.signal);
  } catch (error) {
    if (options.signal.aborted) throw error;
    if (limit.timedOut()) return { skipped: "text extraction timed out" };
    return { skipped: pdfFailureReason(error) };
  }
};

async function readPages(data: Uint8Array): Promise<Extraction> {
  const { extractText, getDocumentProxy } = await loadPdfReader();
  const document = await getDocumentProxy(data, documentOptions);
  try {
    const { text } = await extractText(document, { mergePages: false });
    const segments: TextSegment[] = text
      .map((pageText, index) => ({ text: pageText, page: index + 1 }))
      .filter((segment) => segment.text.trim() !== "");
    if (segments.length === 0) return { skipped: "no text layer (a scanned PDF?)" };
    return { segments };
  } finally {
    // Releases the parsed document; unpdf does the same for documents it opens itself.
    await document.loadingTask.destroy();
  }
}

/** PDF.js cannot be interrupted, so a timeout or cancel stops waiting for it instead. */
function abortable<Value>(work: Promise<Value>, signal: AbortSignal): Promise<Value> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function pdfFailureReason(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "PasswordException") return "password-protected PDF";
  return "not a readable PDF";
}
