// Everything needed to drive the agent loop in a test: two toy tools (one read, one write),
// a session, and a dependency object shaped like the loop's AgentDependencies. It is built
// structurally, so this file needs nothing from src/agent/.

import { z } from "zod";
import {
  type AgentEvent,
  type ChatMessage,
  type LoadedModel,
  type ModelCapabilities,
  type SessionState,
  type ToolContext,
  type ToolDefinition,
  ToolError,
} from "../contracts/index.ts";
import { NamedPermissionGate, PassThroughContextEngine } from "./agent-fakes.ts";
import { ScriptedLmClient, type ScriptedResponse, testModel } from "./scripted-lm-client.ts";
import { createTestToolContext } from "./test-tool-context.ts";

const readNoteParameters = z.object({
  path: z.string(),
  line: z.number().int().positive().optional(),
});

/** A read tool. "missing.txt" fails with a ToolError. */
export const toyReadTool: ToolDefinition<typeof readNoteParameters> = {
  name: "read_note",
  description: "Read a note by path.",
  parameters: readNoteParameters,
  permission: "read",
  resultTokenCap: 200,
  groups: ["core"],
  keyArgument: "path",
  async run(args) {
    if (args.path === "missing.txt") throw new ToolError("missing.txt does not exist.");
    return { text: `contents of ${args.path}${args.line ? ` from line ${args.line}` : ""}` };
  },
};

const writeNoteParameters = z.object({ path: z.string(), text: z.string() });

/** A write tool with a preview. Every write is recorded in `toyWrites`. */
export const toyWrites: { path: string; text: string }[] = [];

export const toyWriteTool: ToolDefinition<typeof writeNoteParameters> = {
  name: "write_note",
  description: "Write a note.",
  parameters: writeNoteParameters,
  permission: "write",
  resultTokenCap: 100,
  groups: ["core"],
  keyArgument: "path",
  async previewChange(args) {
    return { summary: `Write ${args.path}`, targetPaths: [args.path] };
  },
  async run(args) {
    toyWrites.push(args);
    return { text: `wrote ${args.path}` };
  },
};

export function createTestSession(capabilities: Partial<ModelCapabilities> = {}): SessionState {
  const model: LoadedModel = {
    key: testModel.key,
    instanceId: `${testModel.key}:1`,
    contextLength: 16_384,
    capabilities: { ...testModel.capabilities, ...capabilities },
  };
  return {
    id: "test-session",
    messages: [],
    model,
    permissionMode: "ask",
    grants: { tools: new Set(), dataFiles: new Set() },
    reasoning: "on",
    ephemeral: true,
  };
}

export interface AgentLoopKitOptions {
  responses?: ScriptedResponse[];
  tools?: ToolDefinition[];
  /** Tool name to the feedback its denial carries. */
  denied?: Record<string, string>;
}

export async function createAgentLoopKit(options: AgentLoopKitOptions = {}) {
  const testContext = await createTestToolContext();
  const lm = new ScriptedLmClient(options.responses ?? []);
  const context = new PassThroughContextEngine();
  const permissions = new NamedPermissionGate(options.denied ?? {});
  const dependencies = {
    lm,
    context,
    permissions,
    tools: (options.tools ?? [toyReadTool, toyWriteTool]) as ToolDefinition[],
    createToolContext: (signal: AbortSignal): ToolContext => ({ ...testContext.context, signal }),
    config: testContext.context.config,
    workingDirectory: testContext.context.workingDirectory,
  };
  return { dependencies, lm, context, permissions, cleanup: testContext.cleanup };
}

/** The content of every tool message, in order. */
export function toolMessageContents(history: readonly ChatMessage[]): string[] {
  return history.flatMap((message) => (message.role === "tool" ? [message.content] : []));
}

/**
 * Tool call ids that were called and that were answered, each sorted. In well-formed
 * history the two lists are equal: every call has exactly one tool message.
 */
export function toolCallBalance(history: readonly ChatMessage[]): {
  called: string[];
  answered: string[];
} {
  const called = history.flatMap((message) =>
    message.role === "assistant" ? (message.toolCalls ?? []).map((call) => call.id) : [],
  );
  const answered = history.flatMap((message) =>
    message.role === "tool" ? [message.toolCallId] : [],
  );
  return { called: called.sort(), answered: answered.sort() };
}

export async function collectEvents(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const collected: AgentEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}
