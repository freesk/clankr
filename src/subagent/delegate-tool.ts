// `delegate` (Appendix B: core group, read permission): hands a self-contained brief to a
// sub-agent and returns only its capped summary, so the main history never holds the
// sub-agent's tool results.

import { z } from "zod";
import { VixContextEngine } from "../context/index.ts";
import {
  type AgentEvent,
  type AuditLog,
  type Config,
  type ContextEngine,
  type PermissionGate,
  type ToolContext,
  type ToolDefinition,
  ToolError,
} from "../contracts/index.ts";
import { turnLimitNote } from "./instructions.ts";
import { delegateToolName } from "./read-only-tools.ts";
import {
  runSubAgent,
  SubAgentError,
  type SubAgentResult,
  subAgentLimitsFrom,
} from "./run-sub-agent.ts";

const delegateParameters = z.object({
  brief: z.string().min(1).describe("Folders, files, what to find, and what to report"),
});

/** Room for the turn-limit note around the summary, so the summary itself is never stored. */
const resultOverheadTokens = 40;

export interface DelegateToolDependencies {
  /** Loaded config: turn limit and summary cap come from `subagents`. */
  config: Config;
  /** The main loop's tools. Only read tools other than `delegate` reach the sub-agent. */
  tools: readonly ToolDefinition[];
  /** The session's gate. Sub-agent reads go through it; anything else is refused first. */
  permissions: PermissionGate;
  /** Tool context for the sub-agent's calls. Defaults to the delegate call's own context. */
  createToolContext?(signal: AbortSignal): ToolContext;
  /** Defaults to a new VixContextEngine over the session's result store, so handles stay valid. */
  createContextEngine?(toolContext: ToolContext): ContextEngine;
  /** Sub-agent events, for nested tool lines in the cli and validity counts in evals. */
  onEvent?(event: AgentEvent): void;
  /** Each finished delegation, for evals (tokens, tool-call validity). */
  onResult?(result: SubAgentResult): void;
  /** The session's audit log (PERM-8). Read when each delegation starts, so it can follow `/clear`. */
  audit?(): AuditLog;
}

export function createDelegateTool(
  dependencies: DelegateToolDependencies,
): ToolDefinition<typeof delegateParameters> {
  const limits = subAgentLimitsFrom(dependencies.config);
  let running = false;

  return {
    name: delegateToolName,
    description:
      "Hand a broad read-only task, such as searching several folders, to a sub-agent that returns a summary. " +
      "It cannot see this conversation, so the brief must say everything.",
    parameters: delegateParameters,
    permission: "read",
    resultTokenCap: limits.summaryTokenCap + resultOverheadTokens,
    groups: ["core"],
    keyArgument: "brief",
    async run(args, context) {
      // One sub-agent at a time (PRD section 7.3). Checked before any await.
      if (running) throw new ToolError("A sub-agent is already running. Wait for its summary.");
      running = true;
      try {
        const result = await delegate(args.brief, context, dependencies);
        dependencies.onResult?.(result);
        return { text: formatResult(result) };
      } finally {
        running = false;
      }
    },
  };
}

async function delegate(
  brief: string,
  context: ToolContext,
  dependencies: DelegateToolDependencies,
): Promise<SubAgentResult> {
  if (!context.model) throw new ToolError("No model is loaded, so no sub-agent can run.");
  const createToolContext =
    dependencies.createToolContext ?? ((signal: AbortSignal) => ({ ...context, signal }));
  const contextEngine = dependencies.createContextEngine?.(context) ?? defaultEngine(context);
  try {
    return await runSubAgent(brief, dependencies.tools, subAgentLimitsFrom(dependencies.config), {
      lm: context.lm,
      model: context.model,
      reasoning: context.reasoning ?? "off",
      config: dependencies.config,
      permissions: dependencies.permissions,
      createToolContext,
      contextEngine,
      workingDirectory: context.workingDirectory,
      signal: context.signal,
      ...(dependencies.onEvent ? { onEvent: dependencies.onEvent } : {}),
      ...(dependencies.audit ? { audit: dependencies.audit() } : {}),
    });
  } catch (error) {
    // The loop's failure text is already short and safe; anything else stays generic.
    if (error instanceof SubAgentError && !context.signal.aborted)
      throw new ToolError(error.message);
    throw error;
  }
}

function defaultEngine(context: ToolContext): ContextEngine {
  return new VixContextEngine({
    lm: context.lm,
    results: context.results,
    config: context.config,
    ...(context.model ? { model: context.model } : {}),
  });
}

function formatResult(result: SubAgentResult): string {
  return result.endReason === "limit" ? `${result.summary}\n${turnLimitNote}` : result.summary;
}
