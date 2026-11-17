// The in-memory SessionState the cli and the agent loop share, and the settings that follow
// the model: the reasoning default (MOD-9, CTX-7) and the MOD-6 tool-calling warning.

import { toolCallingStyleFor } from "../agent/index.ts";
import type {
  ChatMessage,
  Config,
  LoadedModel,
  PermissionMode,
  ReasoningSetting,
  SessionState,
  ToolGroup,
} from "../contracts/index.ts";

export interface NewSessionStateOptions {
  id: string;
  ephemeral: boolean;
  permissionMode: PermissionMode;
  model?: LoadedModel;
  reasoning?: ReasoningSetting;
  messages?: ChatMessage[];
  activatedToolGroups?: ToolGroup[];
}

export function createSessionState(options: NewSessionStateOptions): SessionState {
  const state: SessionState = {
    id: options.id,
    messages: options.messages ?? [],
    model: options.model,
    permissionMode: options.permissionMode,
    // Grants never carry over: "always for this session" means this session only.
    grants: { tools: new Set(), dataFiles: new Set() },
    reasoning: options.reasoning ?? "off",
    ephemeral: options.ephemeral,
  };
  if (options.activatedToolGroups) state.activatedToolGroups = [...options.activatedToolGroups];
  return state;
}

/** The profile's reasoning setting, else on for a model that reports reasoning support. */
export function reasoningFor(model: LoadedModel, config: Config): ReasoningSetting {
  const configured = config.model.profiles[model.key]?.reasoning;
  if (configured) return configured;
  return model.capabilities.reasoning ? "on" : "off";
}

/** MOD-6: a model not trained for tool use falls back to prompt-based calls, with a warning. */
export function toolCallingWarning(model: LoadedModel, config: Config): string | undefined {
  if (toolCallingStyleFor(model, config) === "native") return undefined;
  if (config.model.profiles[model.key]?.toolCallingStyle === "prompt") return undefined;
  return (
    `${model.key} is not trained for tool use, so vix asks it to write tool calls as text. ` +
    "Expect more failed tool calls; a model with native tool use works better."
  );
}
