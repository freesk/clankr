// Which format a file is saved in (D85). One order for every tool that writes a chart or a
// table:
//   1. the request: the tool's `format` argument or the extension of its `output_path`,
//      when the user's own message names that format (D86);
//   2. the session: `--format`, `/format`, or a pick the user kept;
//   3. the config default, `output.defaultFormat`;
//   4. the user is asked. Where nobody can be asked, the tool fails and names `--format`.
// Steps 1 to 3 need no question, so an approval preview can use them too.

import { type OutputFormat, type ToolContext, ToolError } from "../contracts/index.ts";
import { formatFromPath, formatList } from "./formats.ts";

export interface FormatRequest {
  /** What is being saved, for messages and the question: "chart" or "table". */
  what: string;
  /** Formats that can hold it. */
  allowed: readonly OutputFormat[];
  /** The formats to offer when asking, when fewer than `allowed` fit this call. */
  offered?: readonly OutputFormat[];
  /** The tool's `format` argument. */
  format?: OutputFormat | undefined;
  /** The tool's `output_path` argument; its extension can name a format. */
  outputPath?: string | undefined;
  /** Tells the model what to do when the request names a format that cannot hold this. */
  unsupported(format: OutputFormat): string;
}

export type FormatSource = "request" | "session" | "config" | "user";

export interface ChosenFormat {
  format: OutputFormat;
  source: FormatSource;
}

type FormatContext = Pick<ToolContext, "config" | "outputFormat">;

/** Steps 1 to 3. Undefined means the user has to be asked. */
export function settledOutputFormat(
  request: FormatRequest,
  context: FormatContext,
): ChosenFormat | undefined {
  const named = formatNamedByRequest(request, context);
  if (named) {
    if (!request.allowed.includes(named)) throw new ToolError(request.unsupported(named));
    return { format: named, source: "request" };
  }
  // A session or config format that cannot hold this output was set with other files in mind.
  const session = context.outputFormat?.sessionFormat;
  if (session && request.allowed.includes(session)) return { format: session, source: "session" };
  const configured = context.config.output.defaultFormat;
  if (configured && request.allowed.includes(configured)) {
    return { format: configured, source: "config" };
  }
  return undefined;
}

/** Step 4. Throws a ToolError when nobody can be asked or the user closes the question. */
export async function askOutputFormat(
  request: FormatRequest,
  context: FormatContext,
): Promise<ChosenFormat> {
  const offered = request.offered ?? request.allowed;
  const ask = context.outputFormat?.ask;
  if (!ask) throw new ToolError(cannotAskMessage(request, context, offered));
  const picked = await ask({ what: request.what, formats: offered });
  if (!picked) {
    throw new ToolError(
      `The user closed the format question without choosing, so nothing was saved. Ask which format they want: ${formatList(offered)}.`,
    );
  }
  return { format: picked, source: "user" };
}

export async function resolveOutputFormat(
  request: FormatRequest,
  context: FormatContext,
): Promise<ChosenFormat> {
  return settledOutputFormat(request, context) ?? askOutputFormat(request, context);
}

/** The path's extension first, then the `format` argument, as before formats were shared. */
function formatsInArguments(request: FormatRequest): OutputFormat[] {
  const fromPath = request.outputPath ? formatFromPath(request.outputPath) : undefined;
  return [fromPath, request.format].filter((format) => format !== undefined);
}

/**
 * D86: the arguments are the model's. A format in them counts as the request's only when the
 * user's message names it; a small model fills `format` in from habit, which would hide the
 * choice from the user. Without the user's words to check against, the arguments are trusted.
 */
function formatNamedByRequest(
  request: FormatRequest,
  context: FormatContext,
): OutputFormat | undefined {
  const namedByUser = context.outputFormat?.namedByUser;
  return formatsInArguments(request).find(
    (format) => namedByUser === undefined || namedByUser.includes(format),
  );
}

function cannotAskMessage(
  request: FormatRequest,
  context: FormatContext,
  offered: readonly OutputFormat[],
): string {
  const guessed = formatsInArguments(request)[0];
  const ignored = guessed ? ` "${guessed}" was not used: the user's message does not name it.` : "";
  const session = context.outputFormat?.sessionFormat ?? context.config.output.defaultFormat;
  const unfit =
    session && !request.allowed.includes(session)
      ? ` The format in use, ${session}, cannot hold a ${request.what}.`
      : "";
  return (
    `No output format was chosen for this ${request.what}, and this run cannot ask the user, so nothing was saved.${ignored}${unfit} ` +
    `Do not call the tool again. Tell the user to name a format in the request (${formatList(offered)}) or to rerun with --format <name>.`
  );
}
