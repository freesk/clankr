// read_result (CTX-3): page through or search a stored result by its handle.
// A page is filled only up to the tool's own cap, so a page is never itself stored again.

import { z } from "zod";
import {
  type Config,
  type ResultMeta,
  type ToolContext,
  type ToolDefinition,
  ToolError,
} from "../contracts/index.ts";
import { isResultHandle } from "./handles.ts";
import { truncateEnd } from "./message-text.ts";
import { linesFrom, type NumberedLine } from "./result-pages.ts";

const readResultParameters = z.object({
  handle: z.string(),
  start_line: z.number().int().min(1).optional(),
  line_count: z.number().int().min(1).optional(),
  search: z.string().min(1).optional().describe("Only lines containing this text"),
});

type ReadResultArguments = z.infer<typeof readResultParameters>;

/** Generous on purpose: the page is measured with the real counter before it is returned. */
const charactersPerTokenGuess = 4;

export function createReadResultTool(config: Config): ToolDefinition<typeof readResultParameters> {
  const tokenCap = config.context.defaultResultTokenCap;
  return {
    name: "read_result",
    description:
      "Read a stored tool result by its handle, such as r12, one page of lines at a time.",
    parameters: readResultParameters,
    permission: "read",
    resultTokenCap: tokenCap,
    groups: ["core"],
    keyArgument: "handle",
    run: (args, context) => readResult(args, context, tokenCap),
  };
}

async function readResult(
  args: ReadResultArguments,
  context: ToolContext,
  tokenCap: number,
): Promise<{ text: string }> {
  const meta = await describeOrExplain(args.handle.trim(), context);
  const startLine = args.start_line ?? 1;
  if (startLine > meta.itemCount) {
    throw new ToolError(`${meta.handle} has ${meta.itemCount} lines. Use a start_line up to that.`);
  }
  const lines = collectLines(meta, args, context);
  const page = await fillPage(lines, tokenCap, context, args.line_count);
  return { text: formatPage(meta, args, page) };
}

async function describeOrExplain(handle: string, context: ToolContext): Promise<ResultMeta> {
  const notFound = new ToolError(
    `No stored result "${handle}". Handles look like r12 and appear in earlier tool results.`,
  );
  if (!isResultHandle(handle)) throw notFound;
  try {
    return await context.results.describe(handle);
  } catch {
    throw notFound;
  }
}

async function* collectLines(
  meta: ResultMeta,
  args: ReadResultArguments,
  context: ToolContext,
): AsyncGenerator<NumberedLine> {
  const needle = args.search?.toLowerCase();
  for await (const line of linesFrom(context.results, meta, args.start_line ?? 1)) {
    context.signal.throwIfAborted();
    if (needle === undefined || line.text.toLowerCase().includes(needle)) yield line;
  }
}

interface Page {
  lines: NumberedLine[];
  /** True when more lines (or matches) may follow the page. */
  more: boolean;
  /** The last line looked at, so the next page can start after it. */
  lastScanned: number;
}

async function fillPage(
  lines: AsyncGenerator<NumberedLine>,
  tokenCap: number,
  context: ToolContext,
  lineLimit: number | undefined,
): Promise<Page> {
  const characterBudget = tokenCap * charactersPerTokenGuess;
  const page: Page = { lines: [], more: false, lastScanned: 0 };
  let characters = 0;
  for await (const line of lines) {
    const shown = { ...line, text: truncateEnd(line.text, characterBudget) };
    const reachedLimit = lineLimit !== undefined && page.lines.length >= lineLimit;
    if (reachedLimit || characters + shown.text.length > characterBudget) {
      page.more = true;
      break;
    }
    page.lines.push(shown);
    page.lastScanned = line.lineNumber;
    characters += shown.text.length + String(line.lineNumber).length + 3;
  }
  await lines.return(undefined);
  return shrinkToCap(page, tokenCap, context);
}

/** Drops lines from the end until the page measures under the cap with the real counter. */
async function shrinkToCap(page: Page, tokenCap: number, context: ToolContext): Promise<Page> {
  const fitted = { ...page, lines: [...page.lines] };
  while (fitted.lines.length > 1) {
    const text = fitted.lines.map(numbered).join("\n");
    const tokens = await context.lm.countTokens([{ role: "user", content: text }]);
    if (tokens <= tokenCap * 0.9) break;
    const keep = Math.max(1, Math.floor(fitted.lines.length * ((tokenCap * 0.8) / tokens)));
    fitted.lines = fitted.lines.slice(0, keep);
    fitted.lastScanned = fitted.lines.at(-1)?.lineNumber ?? fitted.lastScanned;
    fitted.more = true;
  }
  return fitted;
}

function formatPage(meta: ResultMeta, args: ReadResultArguments, page: Page): string {
  const what = `${meta.handle} (${meta.label ?? meta.tool}, ${meta.itemCount} lines)`;
  const next = page.lastScanned + 1;
  if (args.search !== undefined) {
    if (page.lines.length === 0) return `${what}: no lines contain "${args.search}".`;
    const tail = page.more
      ? `More matches may follow: search again with start_line ${next}.`
      : "No more matches.";
    return [`${what}: lines containing "${args.search}":`, ...page.lines.map(numbered), tail].join(
      "\n",
    );
  }
  const first = page.lines[0]?.lineNumber ?? args.start_line ?? 1;
  const range = `lines ${first}-${page.lastScanned}`;
  const tail =
    page.lastScanned < meta.itemCount ? `Continue with start_line ${next}.` : "End of result.";
  return [`${what}, ${range}:`, ...page.lines.map(numbered), tail].join("\n");
}

function numbered(line: NumberedLine): string {
  return `${line.lineNumber}: ${line.text}`;
}
