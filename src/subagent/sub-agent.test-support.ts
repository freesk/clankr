// Test fixtures for the subagents part: a sub-agent environment built on the agent-loop kit,
// and a parent loop that offers `delegate`. Excluded from the build.

import { afterEach } from "vitest";
import type {
  AgentEvent,
  ChatRequest,
  LoadedModel,
  ToolContext,
  ToolDefinition,
} from "../contracts/index.ts";
import {
  createAgentLoopKit,
  createTestSession,
  type ScriptedResponse,
  toyReadTool,
  toyWriteTool,
} from "../testing/index.ts";
import { createDelegateTool, type DelegateToolDependencies } from "./delegate-tool.ts";
import type { SubAgentEnvironment } from "./run-sub-agent.ts";

let cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups) await cleanup();
  cleanups = [];
});

export interface SubAgentKitOptions {
  responses: ScriptedResponse[];
  tools?: ToolDefinition[];
  configure?(config: ToolContext["config"]): void;
}

/** Everything `runSubAgent` needs, on fakes, plus the recorded events. */
export async function createSubAgentKit(options: SubAgentKitOptions) {
  const kit = await createAgentLoopKit({
    responses: options.responses,
    tools: options.tools ?? [toyReadTool, toyWriteTool],
  });
  cleanups.push(kit.cleanup);
  options.configure?.(kit.dependencies.config);
  const model = createTestSession().model as LoadedModel;
  const controller = new AbortController();
  const events: AgentEvent[] = [];
  const environment: SubAgentEnvironment = {
    lm: kit.lm,
    model,
    reasoning: "off",
    config: kit.dependencies.config,
    permissions: kit.permissions,
    createToolContext: kit.dependencies.createToolContext,
    contextEngine: kit.context,
    workingDirectory: kit.dependencies.workingDirectory,
    signal: controller.signal,
    onEvent: (event) => events.push(event),
  };
  return { ...kit, environment, controller, events };
}

export interface ParentKitOptions {
  responses: ScriptedResponse[];
  /** The main loop's tools besides `delegate`. */
  tools?: ToolDefinition[];
  delegate?: Partial<DelegateToolDependencies>;
  configure?(config: ToolContext["config"]): void;
}

/**
 * A main loop whose tools include `delegate`. The tool context carries the shared scripted
 * client and the session's model, as integration's `createToolContext` must.
 */
export async function createParentKit(options: ParentKitOptions) {
  const baseTools = options.tools ?? [toyReadTool, toyWriteTool];
  const kit = await createAgentLoopKit({ responses: options.responses, tools: baseTools });
  cleanups.push(kit.cleanup);
  options.configure?.(kit.dependencies.config);
  const session = createTestSession();
  const parentToolContext = kit.dependencies.createToolContext;
  const createToolContext = (signal: AbortSignal): ToolContext => ({
    ...parentToolContext(signal),
    lm: kit.lm,
    reasoning: session.reasoning,
    ...(session.model ? { model: session.model } : {}),
  });
  const subAgentEvents: AgentEvent[] = [];
  const delegateTool = createDelegateTool({
    config: kit.dependencies.config,
    tools: baseTools,
    permissions: kit.permissions,
    onEvent: (event) => subAgentEvents.push(event),
    ...options.delegate,
  });
  const dependencies = {
    ...kit.dependencies,
    tools: [...baseTools, delegateTool] as ToolDefinition[],
    createToolContext,
  };
  return { ...kit, dependencies, session, delegateTool, subAgentEvents, createToolContext };
}

export function toolNamesSent(request: ChatRequest | undefined): string[] {
  return (request?.tools ?? []).map((tool) => tool.name);
}
