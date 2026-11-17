// Running one tool call: validate, gate, run, cap. Whatever happens, the call ends with
// exactly one tool message, so history stays well-formed for the next request.

import type {
  AgentEvent,
  ApprovalBasis,
  AuditEntry,
  ChatMessage,
  ToolCall,
  ToolDefinition,
  ToolOutput,
} from "../contracts/index.ts";
import { type ArgumentCheck, checkArguments } from "./argument-repair.ts";
import {
  cancelledMessage,
  deniedMessage,
  toolFailureMessage,
  unknownToolMessage,
} from "./corrective-errors.ts";
import type { RegisteredTool } from "./registry.ts";
import type { AgentDependencies } from "./types.ts";

export type CallValidity = "valid" | "repaired" | "invalid";

export interface ToolCallOutcome {
  message: Extract<ChatMessage, { role: "tool" }>;
  validity: CallValidity;
  cancelled: boolean;
}

export interface ToolCallScope {
  dependencies: AgentDependencies;
  /** The tools offered this round, by name. A call to anything else is an unknown tool. */
  offered: ReadonlyMap<string, RegisteredTool>;
  signal: AbortSignal;
}

/** What happened when the tool itself was asked to work. */
type RunResult = (
  | { kind: "output"; output: ToolOutput }
  | { kind: "error"; text: string; reason: string }
  | { kind: "cancelled" }
) & {
  /** What the gate said, for the audit log. Absent when the gate was never asked. */
  gate?: GateOutcome;
};

type GateOutcome = { allowed: true; basis?: ApprovalBasis } | { allowed: false };

const keyArgumentDisplayLength = 60;

export async function* executeToolCall(
  call: ToolCall,
  scope: ToolCallScope,
): AsyncGenerator<AgentEvent, ToolCallOutcome> {
  const startedAt = Date.now();
  const tool = scope.offered.get(call.name);
  const check: ArgumentCheck = tool
    ? checkArguments(tool, call.argumentsJson)
    : {
        ok: false,
        error: unknownToolMessage(call.name, [...scope.offered.keys()]),
        bestEffortArgs: {},
      };

  yield {
    type: "tool-start",
    callId: call.id,
    tool: call.name,
    keyArgument: keyArgumentText(tool?.definition, check.ok ? check.args : check.bestEffortArgs),
  };

  const validity: CallValidity = !check.ok ? "invalid" : check.repaired ? "repaired" : "valid";
  const result: RunResult =
    tool && check.ok
      ? await gateAndRun(tool.definition, check.args, scope)
      : { kind: "error", text: check.ok ? "" : check.error, reason: "invalid arguments" };

  const auditArguments = check.ok ? check.args : check.bestEffortArgs;
  if (result.kind === "cancelled") {
    yield toolEnd(call.id, startedAt, 0, validity, "cancelled");
    await recordAudit(scope, call.name, auditArguments, result, startedAt);
    return { message: toolMessage(call.id, cancelledMessage), validity, cancelled: true };
  }

  const output = result.kind === "output" ? result.output : { text: result.text };
  const capped = await scope.dependencies.context.capResult(
    output,
    tool?.definition.resultTokenCap ?? scope.dependencies.config.context.defaultResultTokenCap,
    { tool: call.name, arguments: auditArguments },
  );
  const error = result.kind === "error" ? result.reason : undefined;
  yield toolEnd(call.id, startedAt, capped.tokens, validity, error);
  await recordAudit(scope, call.name, auditArguments, result, startedAt);
  return { message: toolMessage(call.id, capped.text), validity, cancelled: false };
}

async function gateAndRun(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  scope: ToolCallScope,
): Promise<RunResult> {
  const toolContext = scope.dependencies.createToolContext(scope.signal);
  // Filled in as the call goes, so a cancelled call still reports what the gate said.
  let gate: GateOutcome | undefined;
  const result = await settleUnlessCancelled(scope.signal, async (): Promise<RunResult> => {
    try {
      const preview =
        tool.permission === "read" ? undefined : await tool.previewChange?.(args, toolContext);
      const decision = await scope.dependencies.permissions.check(
        { name: tool.name, permission: tool.permission },
        args,
        preview,
      );
      if (!decision.allowed) {
        gate = { allowed: false };
        return { kind: "error", text: deniedMessage(decision.feedback), reason: "denied" };
      }
      gate = decision.basis ? { allowed: true, basis: decision.basis } : { allowed: true };
      return { kind: "output", output: await tool.run(args, toolContext) };
    } catch (error) {
      if (scope.signal.aborted) return { kind: "cancelled" };
      return { kind: "error", text: toolFailureMessage(tool.name, error), reason: "failed" };
    }
  });
  return gate ? { ...result, gate } : result;
}

/**
 * PERM-8: one audit entry per call, after it ends. A call the gate never saw (invalid
 * arguments, an unknown tool, or cancelled before the decision) is logged as denied and not run.
 */
async function recordAudit(
  scope: ToolCallScope,
  tool: string,
  args: Record<string, unknown>,
  result: RunResult,
  startedAt: number,
): Promise<void> {
  const audit = scope.dependencies.audit;
  if (!audit) return;
  const gate = result.gate;
  const ran = gate?.allowed === true && result.kind !== "cancelled";
  const entry: AuditEntry = {
    tool,
    arguments: args,
    decision: gate?.allowed ? "allowed" : "denied",
    outcome: !ran ? "not-run" : result.kind === "output" ? "ok" : "error",
    durationMs: Date.now() - startedAt,
  };
  if (gate?.allowed && gate.basis) entry.basis = gate.basis;
  if (result.kind === "error") entry.error = result.text;
  if (result.kind === "cancelled") entry.error = cancelledMessage;
  // The log must never break a turn: a full disk loses an audit line, not the answer.
  await audit.record(entry).catch(() => undefined);
}

/**
 * Cancellation must end the turn promptly (CLI-5) even if a tool ignores its signal, so the
 * work is raced against the abort. A tool that ignores the signal may finish in the background.
 */
function settleUnlessCancelled(
  signal: AbortSignal,
  work: () => Promise<RunResult>,
): Promise<RunResult> {
  if (signal.aborted) return Promise.resolve({ kind: "cancelled" });
  return new Promise((resolve) => {
    const onAbort = () => resolve({ kind: "cancelled" });
    signal.addEventListener("abort", onAbort, { once: true });
    work().then((result) => {
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    });
  });
}

function keyArgumentText(tool: ToolDefinition | undefined, args: Record<string, unknown>): string {
  if (!tool?.keyArgument) return "";
  const value = args[tool.keyArgument];
  if (value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > keyArgumentDisplayLength
    ? `${text.slice(0, keyArgumentDisplayLength - 1)}…`
    : text;
}

function toolEnd(
  callId: string,
  startedAt: number,
  resultTokens: number,
  validity: CallValidity,
  error: string | undefined,
): AgentEvent {
  return {
    type: "tool-end",
    callId,
    resultTokens,
    durationMs: Date.now() - startedAt,
    validity,
    ...(error === undefined ? {} : { error }),
  };
}

function toolMessage(toolCallId: string, content: string): ToolCallOutcome["message"] {
  return { role: "tool", toolCallId, content };
}
