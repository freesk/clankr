// `read_file` (SRCH-5): a line range of a text file, with line numbers. Refuses binary
// files with a pointer to the right tool, and records every read in the ReadTracker so
// `write_file` can refuse to overwrite a file the model never saw (FS-1).

import { open } from "node:fs/promises";
import { createInterface } from "node:readline";
import { z } from "zod";
import { defaultConfig } from "../../config/index.ts";
import { type ToolContext, type ToolDefinition, ToolError } from "../../contracts/index.ts";
import { binaryFilePointer, looksBinary } from "./binary-content.ts";
import { displayRoot, formatSize, relativeDisplay, truncateLine } from "./format.ts";
import { resolveExistingPath } from "./paths.ts";

/** Above this size the total line count is not worth reading the whole file for. */
const maxBytesToCountLines = 20 * 1024 * 1024;

const readFileParameters = z.object({
  path: z.string().min(1),
  start_line: z.number().int().min(1).optional(),
  line_count: z.number().int().min(1).optional(),
});

type ReadFileArguments = z.infer<typeof readFileParameters>;

export const readFileTool: ToolDefinition<typeof readFileParameters> = {
  name: "read_file",
  description:
    "Read a text file's lines with line numbers. For images use view_image; for spreadsheets and Word files use inspect_data.",
  parameters: readFileParameters,
  permission: "read",
  resultTokenCap: defaultConfig().context.defaultResultTokenCap,
  groups: ["core"],
  keyArgument: "path",
  run: readFile,
};

interface LineRange {
  lines: string[];
  /** Undefined when the file was too large to count to the end. */
  totalLines: number | undefined;
}

async function readFile(args: ReadFileArguments, context: ToolContext) {
  const { realPath, stats } = await resolveExistingPath(args.path, context);
  const name = displayName(realPath, context.workingDirectory);
  if (stats.isDirectory()) {
    throw new ToolError(`${name} is a folder. Use list_dir to see what is in it.`);
  }

  const startLine = args.start_line ?? 1;
  const lineCount = args.line_count ?? context.config.search.readFileDefaultLines;
  const file = await open(realPath, "r");
  let range: LineRange;
  try {
    if (await looksBinary(file)) throw new ToolError(binaryFilePointer(name));
    range = await readLineRange(file, startLine, lineCount, stats.size <= maxBytesToCountLines);
  } finally {
    await file.close();
  }
  // Recorded only after a successful read: a refused binary file was not "seen".
  context.readTracker.markRead(realPath, { modifiedTimeMs: stats.mtimeMs, sizeBytes: stats.size });

  if (range.totalLines === 0) return { text: `${name} is empty.` };
  if (range.lines.length === 0) {
    throw new ToolError(
      `${name} has ${range.totalLines} lines, so start_line ${startLine} is past the end.`,
    );
  }
  const lastLine = startLine + range.lines.length - 1;
  const total = range.totalLines === undefined ? "?" : range.totalLines.toLocaleString("en-US");
  const header = `${name} · lines ${startLine}-${lastLine} of ${total} · ${formatSize(stats.size)}`;
  const maxLength = context.config.search.maxLineLength;
  const width = String(lastLine).length;
  const numbered = range.lines.map(
    (line, index) =>
      `${String(startLine + index).padStart(width)}\t${truncateLine(line, maxLength)}`,
  );
  return { text: [header, ...numbered].join("\n") };
}

/** Streams the file, keeping only the requested lines, so a huge log costs little memory. */
async function readLineRange(
  file: Awaited<ReturnType<typeof open>>,
  startLine: number,
  lineCount: number,
  countToEnd: boolean,
): Promise<LineRange> {
  const reader = createInterface({
    input: file.createReadStream({ start: 0, encoding: "utf8", autoClose: false }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  const lines: string[] = [];
  const endLine = startLine + lineCount - 1;
  let lineNumber = 0;
  let reachedEnd = true;
  for await (const line of reader) {
    lineNumber++;
    if (lineNumber >= startLine && lineNumber <= endLine) lines.push(line);
    if (lineNumber >= endLine && !countToEnd) {
      reachedEnd = false;
      break;
    }
  }
  reader.close();
  return { lines, totalLines: reachedEnd ? lineNumber : undefined };
}

/** Relative to the working folder when inside it, otherwise with "~" for the home folder. */
function displayName(realPath: string, workingDirectory: string): string {
  const relativePath = relativeDisplay(workingDirectory, realPath);
  return relativePath.startsWith("..") ? displayRoot(realPath) : relativePath;
}
