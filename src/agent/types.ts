// The agent loop's own types: what a caller hands `runTurn`, and what a turn takes as input.

import type {
  Config,
  ContextEngine,
  LmClient,
  PermissionGate,
  ToolContext,
  ToolDefinition,
} from "../contracts/index.ts";

/** Native tool calls through the API's tools field, or a text format parsed from the reply (MOD-6). */
export type ToolCallingStyle = "native" | "prompt";

/**
 * Reference text loaded into the system prompt only while one tool is in use (DATA-16).
 * The text belongs to the tool's part (for `make_chart`, chart); the loop decides when it is shown.
 */
export interface ToolReference {
  toolName: string;
  text: string;
  /** Words in the user's message that mean the tool is about to be needed, such as "chart". */
  triggerWords: string[];
}

/**
 * Everything `runTurn` needs from the rest of the harness. Integration wires the real
 * parts; tests and sub-agents wire fakes or their own instances.
 */
export interface AgentDependencies {
  lm: LmClient;
  context: ContextEngine;
  permissions: PermissionGate;
  /** Every tool this loop may offer. Scoping (CTX-8) picks the subset sent each round. */
  tools: readonly ToolDefinition[];
  /** Builds the context a tool runs with. The signal is the turn's, so tools can be cancelled. */
  createToolContext(signal: AbortSignal): ToolContext;
  config: Config;
  /** Where `vix` was started; stated in the system prompt so relative paths make sense. */
  workingDirectory: string;
  /** Tool references such as the Vega-Lite guide. Optional. */
  toolReferences?: readonly ToolReference[];
  /** Extra instructions appended to the system prompt, for example a sub-agent's brief rules. */
  extraInstructions?: string;
}

/** What the user sent: prose, plus any file paths attached by typing or dragging (CLI-10). */
export interface TurnInput {
  text: string;
  attachmentPaths?: string[];
}
