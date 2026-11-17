// One-shot mode (CLI-2, CLI-11): run one turn, print plain text or JSON, return the exit status.
// Plain mode streams the answer to stdout and tool lines to stderr, so stdout stays scriptable.

import type { AgentEvent, TurnEndReason } from "../contracts/index.ts";
import { extractAttachments } from "./attachments.ts";
import type { TextSink } from "./cli-environment.ts";
import { type ExitCode, exitCodes } from "./exit-codes.ts";
import type { Harness } from "./harness.ts";
import { type Denial, describeDenial, type OneShotApprovalPrompter } from "./one-shot-prompter.ts";
import { errorMessage, redactSecrets } from "./secrets.ts";
import { ToolLineTracker } from "./tool-lines.ts";

export interface OneShotRequest {
  prompt: string;
  json: boolean;
  harness: Harness;
  prompter: OneShotApprovalPrompter;
  signal: AbortSignal;
  stdout: TextSink;
  stderr: TextSink;
  workingDirectory: string;
}

interface ToolCallSummary {
  tool: string;
  keyArgument: string;
  resultTokens: number;
  durationMs: number;
  error?: string;
}

interface TurnOutcome {
  text: string;
  reason: TurnEndReason;
  message: string | undefined;
  toolCalls: ToolCallSummary[];
}

export async function runOneShot(request: OneShotRequest): Promise<ExitCode> {
  const outcome = await collectTurn(request);
  const denials = request.prompter.denials;
  const exitCode = exitCodeFor(outcome.reason, denials);
  if (request.json) {
    writeJson(request, outcome, denials, exitCode);
  } else {
    writePlainEnding(request, outcome, denials);
  }
  return exitCode;
}

export function exitCodeFor(reason: TurnEndReason, denials: readonly Denial[]): ExitCode {
  if (reason === "cancelled") return exitCodes.cancelled;
  if (reason !== "done" || denials.length > 0) return exitCodes.failed;
  return exitCodes.done;
}

async function collectTurn(request: OneShotRequest): Promise<TurnOutcome> {
  const outcome: TurnOutcome = { text: "", reason: "error", message: undefined, toolCalls: [] };
  const tracker = new ToolLineTracker();
  const input = extractAttachments(request.prompt, {
    workingDirectory: request.workingDirectory,
  });
  let sawTurnEnd = false;
  try {
    for await (const event of request.harness.runTurn(input, request.signal)) {
      applyEvent(event, outcome, tracker, request);
      if (event.type === "turn-end") sawTurnEnd = true;
    }
    if (!sawTurnEnd) outcome.message = "The turn ended without a result.";
  } catch (error) {
    outcome.reason = request.signal.aborted ? "cancelled" : "error";
    outcome.message = errorMessage(error);
  }
  if (request.signal.aborted) outcome.reason = "cancelled";
  return outcome;
}

function applyEvent(
  event: AgentEvent,
  outcome: TurnOutcome,
  tracker: ToolLineTracker,
  request: OneShotRequest,
): void {
  const config = request.harness.config;
  switch (event.type) {
    case "text":
      outcome.text += event.delta;
      if (!request.json) request.stdout.write(redactSecrets(event.delta, config));
      return;
    case "model-call-start":
      return;
    case "reasoning":
      // Never mixed into the answer; one-shot output has no dimmed channel, so it is hidden.
      return;
    case "tool-start":
      tracker.start(event);
      return;
    case "tool-end": {
      const line = tracker.end(event);
      outcome.toolCalls.push({
        tool: line.tool,
        keyArgument: line.keyArgument,
        resultTokens: event.resultTokens,
        durationMs: event.durationMs,
        ...(event.error ? { error: event.error } : {}),
      });
      if (!request.json) request.stderr.write(`${redactSecrets(line.text, config)}\n`);
      return;
    }
    case "turn-end":
      outcome.reason = event.reason;
      outcome.message = event.message;
      return;
  }
}

function writePlainEnding(
  request: OneShotRequest,
  outcome: TurnOutcome,
  denials: readonly Denial[],
): void {
  const config = request.harness.config;
  if (outcome.text !== "" && !outcome.text.endsWith("\n")) request.stdout.write("\n");
  for (const denial of denials) {
    request.stderr.write(`${redactSecrets(describeDenial(denial), config)}\n`);
  }
  if (outcome.reason === "done") return;
  const fallback =
    outcome.reason === "cancelled" ? "Cancelled." : `The turn ended: ${outcome.reason}.`;
  request.stderr.write(`clankr: ${redactSecrets(outcome.message ?? fallback, config)}\n`);
}

function writeJson(
  request: OneShotRequest,
  outcome: TurnOutcome,
  denials: readonly Denial[],
  exitCode: ExitCode,
): void {
  const session = request.harness.session();
  const document = {
    text: outcome.text,
    reason: outcome.reason,
    exitCode,
    ...(outcome.message ? { message: outcome.message } : {}),
    model: session.model?.key ?? request.harness.config.model.default,
    toolCalls: outcome.toolCalls,
    denials,
  };
  const serialized = JSON.stringify(document, null, 2);
  request.stdout.write(`${redactSecrets(serialized, request.harness.config)}\n`);
}
