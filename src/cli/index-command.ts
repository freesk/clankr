// `clankr index` and `/index` (SRCH-9): the front end only. Both hand an IndexRequest to the
// composition, which runs it with the real parts; this module draws progress, wires Ctrl+C
// to the run, and maps the outcome to an exit status.

import type {
  IndexOutcome,
  IndexProgress,
  IndexRequest,
  SlashCommand,
} from "../contracts/index.ts";
import type { CliEnvironment, TextSink } from "./cli-environment.ts";
import { loadConfigOrReport } from "./config-loading.ts";
import { type ExitCode, exitCodes } from "./exit-codes.ts";
import type { CliComposition } from "./harness.ts";
import { parseIndexArgumentText } from "./index-arguments.ts";
import { errorMessage, redactSecrets } from "./secrets.ts";

const outcomeExitCodes: Record<IndexOutcome, ExitCode> = {
  done: exitCodes.done,
  failed: exitCodes.failed,
  cancelled: exitCodes.cancelled,
};

/** How often progress is redrawn in place on a terminal, and printed as a line elsewhere. */
const inPlaceIntervalMs = 100;
const lineIntervalMs = 2_000;
const clearLine = "\r\x1b[2K";

export async function runIndexCommand(
  request: IndexRequest,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const config = await loadConfigOrReport({}, environment);
  if (!config) return exitCodes.usage;

  const controller = new AbortController();
  let interruptCount = 0;
  // CLI-5: the first Ctrl+C stops the run between files; a second one exits at once.
  const removeInterruptHandler = environment.onInterrupt(() => {
    interruptCount += 1;
    controller.abort();
    if (interruptCount > 1) environment.forceExit(exitCodes.cancelled);
  });
  const progress = progressDisplay(environment.stderr, environment.stdout.isTTY === true);
  try {
    const outcome = await environment.composition.runIndexRequest(request, {
      config,
      workingDirectory: environment.workingDirectory,
      signal: controller.signal,
      print: (text) => {
        progress.clear();
        environment.stdout.write(`${redactSecrets(text, config)}\n`);
      },
      showProgress: progress.show,
    });
    return outcomeExitCodes[outcome];
  } catch (error) {
    progress.clear();
    environment.stderr.write(`clankr: ${redactSecrets(errorMessage(error), config)}\n`);
    return exitCodes.failed;
  } finally {
    removeInterruptHandler();
  }
}

export interface IndexSlashCommandOptions {
  composition: CliComposition;
  workingDirectory: string;
  /** An ephemeral session leaves nothing on disk (CLI-7), so it may list indexes but not change them. */
  ephemeral: boolean;
}

export function createIndexSlashCommand(options: IndexSlashCommandOptions): SlashCommand {
  return {
    name: "index",
    summary: "Index a folder for search by meaning, or list the indexed folders",
    usage: "/index [--rebuild | --remove] [folder]",
    async run(argumentText, context) {
      const parsed = parseIndexArgumentText(argumentText);
      if (!parsed.ok) {
        context.print(parsed.error);
        return;
      }
      if (options.ephemeral && parsed.request.action !== "status") {
        context.print(
          "This session is ephemeral and leaves nothing on disk, so it cannot change an index. Run `clankr index` in a terminal.",
        );
        return;
      }
      await options.composition.runIndexRequest(parsed.request, {
        config: context.config,
        workingDirectory: options.workingDirectory,
        signal: context.signal ?? new AbortController().signal,
        print: context.print,
        showProgress: throttled(lineIntervalMs, (progress) =>
          context.print(progressText(progress)),
        ),
      });
    },
  };
}

function progressText(progress: IndexProgress): string {
  const total = progress.filesTotal.toLocaleString("en-US");
  return `Indexing: ${progress.filesDone.toLocaleString("en-US")} of ${total} files`;
}

/** Passes on at most one call per interval, so a long run neither floods nor goes silent. */
function throttled(
  intervalMs: number,
  show: (progress: IndexProgress) => void,
): (progress: IndexProgress) => void {
  let lastShownAt = Number.NEGATIVE_INFINITY;
  return (progress) => {
    const now = Date.now();
    if (now - lastShownAt < intervalMs) return;
    lastShownAt = now;
    show(progress);
  };
}

/** One line redrawn in place on a terminal; a line every few seconds into a pipe or a file. */
function progressDisplay(
  sink: TextSink,
  inPlace: boolean,
): { show(progress: IndexProgress): void; clear(): void } {
  let lineIsDrawn = false;
  const draw = (progress: IndexProgress): void => {
    sink.write(inPlace ? `${clearLine}${progressText(progress)}` : `${progressText(progress)}\n`);
    lineIsDrawn = inPlace;
  };
  return {
    show: throttled(inPlace ? inPlaceIntervalMs : lineIntervalMs, draw),
    clear() {
      if (lineIsDrawn) sink.write(clearLine);
      lineIsDrawn = false;
    },
  };
}
