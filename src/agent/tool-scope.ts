// Which tools the model sees this round (CTX-8, MOD-6, D15), which calling style it gets,
// and which tool references are loaded (DATA-16).

import type {
  ChatMessage,
  Config,
  LoadedModel,
  SessionState,
  ToolGroup,
} from "../contracts/index.ts";
import type { RegisteredTool, ToolRegistry } from "./registry.ts";
import type { ToolCallingStyle, ToolReference } from "./types.ts";

/** The DATA-1 formats. A path ending in one of these switches the data group on (D15). */
const dataFilePathPattern = /[^\s"'`<>()[\]{}|,;]+\.(?:xlsx|xls|csv|tsv|docx)(?!\w)/i;

/** The per-model profile wins (MOD-9); otherwise the model's reported training decides. */
export function toolCallingStyleFor(model: LoadedModel, config: Config): ToolCallingStyle {
  const profileStyle = config.model.profiles[model.key]?.toolCallingStyle;
  if (profileStyle) return profileStyle;
  return model.capabilities.trainedForToolUse ? "native" : "prompt";
}

export function mentionsDataFile(text: string): boolean {
  return dataFilePathPattern.test(text);
}

/**
 * Switches the data group on once a data file path has appeared in a user message, an
 * attachment, or a tool result. The model's own text does not count: `inspect_data` is a
 * data tool, so the harness, not the model, has to notice the file. The switch is stored on
 * the session so it survives eviction and compaction removing the path from history.
 */
export function activateGroupsFromHistory(session: SessionState): void {
  if (session.activatedToolGroups?.includes("data")) return;
  if (session.messages.some(messageMentionsDataFile)) activateGroup(session, "data");
}

function activateGroup(session: SessionState, group: ToolGroup): void {
  session.activatedToolGroups = [...(session.activatedToolGroups ?? []), group];
}

function messageMentionsDataFile(message: ChatMessage): boolean {
  if (message.role === "tool") return mentionsDataFile(message.content);
  if (message.role !== "user") return false;
  if (typeof message.content === "string") return mentionsDataFile(message.content);
  return message.content.some((part) => part.type === "text" && mentionsDataFile(part.text));
}

export function activeGroups(model: LoadedModel, session: SessionState): Set<ToolGroup> {
  const groups = new Set<ToolGroup>(["core"]);
  if (model.capabilities.vision) groups.add("vision");
  for (const group of session.activatedToolGroups ?? []) {
    // Vision follows the model, never the session, so a switch to a text-only model drops it.
    if (group !== "vision") groups.add(group);
  }
  return groups;
}

/** Registration order is kept, so the tool list only changes when a group switches. */
export function scopedTools(registry: ToolRegistry, groups: Set<ToolGroup>): RegisteredTool[] {
  return registry
    .list()
    .filter((tool) => tool.definition.groups.some((group) => groups.has(group)));
}

/**
 * A reference is loaded while its tool is offered and either the user's message asks for
 * what the tool does, or the tool was called within the last `ageLimitTurns` turns.
 */
export function activeReferences(
  references: readonly ToolReference[],
  tools: readonly RegisteredTool[],
  history: readonly ChatMessage[],
  ageLimitTurns: number,
): ToolReference[] {
  const offered = new Set(tools.map((tool) => tool.definition.name));
  const latestUserText = lastUserText(history).toLowerCase();
  return references.filter((reference) => {
    if (!offered.has(reference.toolName)) return false;
    if (reference.triggerWords.some((word) => latestUserText.includes(word.toLowerCase()))) {
      return true;
    }
    const age = turnsSinceCall(history, reference.toolName);
    return age !== undefined && age <= ageLimitTurns;
  });
}

/** Number of user messages after the last call to `toolName`; undefined if never called. */
export function turnsSinceCall(
  history: readonly ChatMessage[],
  toolName: string,
): number | undefined {
  let userMessagesSeen = 0;
  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index] as ChatMessage;
    if (message.role === "user") userMessagesSeen++;
    if (message.role === "assistant" && message.toolCalls?.some((call) => call.name === toolName)) {
      return userMessagesSeen;
    }
  }
  return undefined;
}

/** The text of the user's latest message: the request the current turn is answering. */
export function lastUserText(history: readonly ChatMessage[]): string {
  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index] as ChatMessage;
    if (message.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    return message.content.map((part) => (part.type === "text" ? part.text : "")).join(" ");
  }
  return "";
}
