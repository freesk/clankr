// What one round sends: the tools in scope, the calling style, the system prompt, and the
// final chat request built from the message list the context engine prepared.

import type {
  ChatMessage,
  ChatRequest,
  LoadedModel,
  SamplingParameters,
  SessionState,
  ToolGroup,
} from "../contracts/index.ts";
import { toPromptStyleMessages } from "./prompt-tool-style.ts";
import type { RegisteredTool, ToolRegistry } from "./registry.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import { activeGroups, activeReferences, scopedTools, toolCallingStyleFor } from "./tool-scope.ts";
import type { AgentDependencies, ToolCallingStyle } from "./types.ts";

export interface RoundPlan {
  style: ToolCallingStyle;
  tools: RegisteredTool[];
  systemPrompt: string;
}

export function planRound(
  dependencies: AgentDependencies,
  registry: ToolRegistry,
  model: LoadedModel,
  session: SessionState,
  availableGroups: readonly ToolGroup[] = [],
): RoundPlan {
  const style = toolCallingStyleFor(model, dependencies.config);
  const tools = scopedTools(registry, activeGroups(model, session, availableGroups));
  // The reference is dropped at the same age as stale tool results (specs/agent-loop.md).
  const references = activeReferences(
    dependencies.toolReferences ?? [],
    tools,
    session.messages,
    dependencies.config.context.evictToolResultsAfterTurns,
  );
  const systemPrompt = buildSystemPrompt({
    workingDirectory: dependencies.workingDirectory,
    style,
    tools,
    references,
    ...(dependencies.extraInstructions
      ? { extraInstructions: dependencies.extraInstructions }
      : {}),
  });
  return { style, tools, systemPrompt };
}

/** In the prompt-based style the tools live in the system prompt, not the tools field. */
export function toolSchemasToSend(plan: RoundPlan): RegisteredTool["schema"][] {
  return plan.style === "native" ? plan.tools.map((tool) => tool.schema) : [];
}

export function buildChatRequest(
  dependencies: AgentDependencies,
  model: LoadedModel,
  session: SessionState,
  plan: RoundPlan,
  prepared: ChatMessage[],
): ChatRequest {
  const request: ChatRequest = {
    // The instance id, so LM Studio answers with the instance loaded at the configured length.
    model: model.instanceId,
    messages: plan.style === "prompt" ? toPromptStyleMessages(prepared) : prepared,
    reasoning: session.reasoning,
    maxTokens: dependencies.context.budgets().response,
  };
  const schemas = toolSchemasToSend(plan);
  if (schemas.length > 0) request.tools = schemas;
  const sampling = samplingFor(dependencies, model);
  if (sampling) request.sampling = sampling;
  return request;
}

/** Sampling parameters from the model's profile (MOD-9), or none to keep LM Studio's own. */
function samplingFor(
  dependencies: AgentDependencies,
  model: LoadedModel,
): SamplingParameters | undefined {
  const profile = dependencies.config.model.profiles[model.key];
  if (!profile) return undefined;
  const sampling: SamplingParameters = {};
  if (profile.temperature !== undefined) sampling.temperature = profile.temperature;
  if (profile.topK !== undefined) sampling.topK = profile.topK;
  if (profile.topP !== undefined) sampling.topP = profile.topP;
  return Object.keys(sampling).length > 0 ? sampling : undefined;
}
