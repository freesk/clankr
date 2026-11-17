// Short error texts sent back to the model when a call is rejected or fails. Each names the
// tool, what went wrong, and what to do next. No stack traces reach the model (PRD section 6.2).

import type { z } from "zod";
import { ToolError } from "../contracts/index.ts";

export function unknownToolMessage(name: string, availableNames: string[]): string {
  return `Unknown tool "${name}". Available tools: ${availableNames.join(", ")}.`;
}

export function unparseableArgumentsMessage(signature: string): string {
  return `Could not read the arguments as a JSON object. Call again with one flat JSON object matching ${signature}.`;
}

export function invalidArgumentsMessage(issues: z.core.$ZodIssue[], signature: string): string {
  const problems = issues.slice(0, 3).map(describeIssue).join("; ");
  return `Invalid arguments: ${problems}. Expected ${signature}. Fix the arguments and call again.`;
}

function describeIssue(issue: z.core.$ZodIssue): string {
  const field = issue.path.length > 0 ? `"${issue.path.join(".")}"` : "arguments";
  // zod prefixes most messages with "Invalid input: ", which adds nothing here.
  const message = issue.message.replace(/^Invalid input: /, "");
  return `${field} ${message}`;
}

export function deniedMessage(feedback: string): string {
  const trimmed = feedback.trim();
  return trimmed === ""
    ? "The user denied this call. Do not retry it; ask the user how to proceed."
    : `The user denied this call and said: ${trimmed}`;
}

export const cancelledMessage = "Cancelled by the user.";

/**
 * A ToolError's message is written for the model. Any other error may hold a stack,
 * a path, or a secret, so the model gets a generic line instead.
 */
export function toolFailureMessage(toolName: string, error: unknown): string {
  if (isToolError(error)) return error.message;
  return `${toolName} failed unexpectedly. Try different arguments or another tool.`;
}

/** Checked by name as well, so a ToolError from a second copy of the module still counts. */
function isToolError(error: unknown): error is Error {
  return error instanceof ToolError || (error instanceof Error && error.name === "ToolError");
}
