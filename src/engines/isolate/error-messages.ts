// Short error messages for the model: what went wrong, the line in its own code, and what to try.
// No host stack frames, no host paths (specs/sandbox.md, "Errors are short").

import type { IsolateLimits } from "../../contracts/index.ts";
import { modelCodeFilename } from "./isolate-source.ts";

/** Why the host stopped the isolate, when it did. */
export type StopReason = "timeout" | "cancelled";

/** What the wrapper in isolate-source.ts reports when the model's code throws. */
export interface ModelCodeFailure {
  message: string;
  line?: number;
}

export function timeoutMessage(limits: IsolateLimits): string {
  return (
    `Stopped: the code ran longer than ${formatSeconds(limits.timeoutMs)}. ` +
    "Do less work per call, or aggregate with query_sql first."
  );
}

export function memoryMessage(limits: IsolateLimits): string {
  return (
    `Stopped: the code used more than ${limits.memoryLimitMb} MB of memory. ` +
    "Work on fewer rows, or aggregate with query_sql first."
  );
}

export const cancelledMessage = "Cancelled before the code finished.";

/** A failure inside the model's code, with the line when it lies within that code. */
export function modelCodeFailureMessage(failure: ModelCodeFailure, codeLineCount: number): string {
  const { message, line } = failure;
  if (line === undefined || line < 1 || line > codeLineCount) return message;
  return `${message} (line ${line})`;
}

/**
 * Shapes an error thrown on the host while compiling or running the isolate. The stop reason,
 * when the host stopped the isolate itself, decides the message; otherwise the error's own text
 * is matched against what `isolated-vm` reports.
 */
export function hostErrorMessage(
  error: unknown,
  stopReason: StopReason | undefined,
  limits: IsolateLimits,
  codeLineCount: number,
): string {
  if (stopReason === "cancelled") return cancelledMessage;
  if (stopReason === "timeout") return timeoutMessage(limits);

  const message = error instanceof Error ? error.message : String(error);
  if (/memory limit/i.test(message)) return memoryMessage(limits);
  if (/timed out/i.test(message)) return timeoutMessage(limits);
  if (error instanceof SyntaxError) return syntaxErrorMessage(message, codeLineCount);
  return `The sandbox failed: ${firstLine(message)}`;
}

// isolated-vm appends the location as "[code.js:3:11]".
function syntaxErrorMessage(message: string, codeLineCount: number): string {
  const locationPattern = new RegExp(`\\s*\\[${escapeRegExp(modelCodeFilename)}:(\\d+):\\d+\\]`);
  const match = locationPattern.exec(message);
  const text = `SyntaxError: ${firstLine(message.replace(locationPattern, ""))}`;
  const line = match ? Number(match[1]) : undefined;
  return modelCodeFailureMessage(
    line === undefined ? { message: text } : { message: text, line },
    codeLineCount,
  );
}

function formatSeconds(milliseconds: number): string {
  const seconds = milliseconds / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
}

function firstLine(text: string): string {
  return text.split("\n")[0] ?? text;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
