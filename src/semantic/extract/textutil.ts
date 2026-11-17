// Word-like documents (.docx, .doc, .rtf, .odt) through the macOS built-in `textutil`.
// The same pattern as `sips` for images (D39): a fixed system binary, started with an
// argument list and never through a shell, working offline. Its only variable argument is a
// path the indexer found on disk; nothing the model wrote reaches it.

import { runProcess } from "../../tools/search/run-process.ts";
import { type ExtractionOptions, extractionSignal, type TextExtractor } from "./extractor.ts";

/** Absolute, so a `textutil` earlier on PATH cannot stand in for the system one. */
export const textutilPath = "/usr/bin/textutil";

export const extractWithTextutil: TextExtractor = async (path, options) => {
  const limit = extractionSignal(options);
  try {
    const { exitCode, text, errors } = await convertToText(path, limit.signal);
    // textutil exits 0 even when it fails; it then writes no text and explains on stderr.
    const failed = exitCode !== 0 || (text === "" && errors !== "");
    if (failed) return { skipped: "textutil could not read it" };
    return { segments: [{ text }] };
  } catch (error) {
    if (options.signal.aborted) throw error;
    if (limit.timedOut()) return { skipped: "text extraction timed out" };
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { skipped: "the macOS textutil command was not found" };
    }
    return { skipped: "textutil could not read it" };
  }
};

async function convertToText(
  path: string,
  signal: ExtractionOptions["signal"],
): Promise<{ exitCode: number | null; text: string; errors: string }> {
  let text = "";
  const run = await runProcess(
    textutilPath,
    ["-convert", "txt", "-encoding", "UTF-8", "-stdout", path],
    {
      signal,
      // Text never holds a NUL, so the whole output arrives as one record, blank lines intact.
      separator: "\0",
      onRecord: (record) => {
        text += record;
        return true;
      },
    },
  );
  return { exitCode: run.exitCode, text, errors: run.stderr.trim() };
}
