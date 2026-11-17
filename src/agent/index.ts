// agent-loop part (specs/agent-loop.md): the turn loop, the tool registry, tool-call
// parsing, tool scoping, the system prompt, and `/think`.
//
// Entry point:
//
//   runTurn(dependencies, session, input, signal): AsyncGenerator<AgentEvent>
//
//   dependencies  AgentDependencies: { lm, context, permissions, tools, createToolContext,
//                 config, workingDirectory, toolReferences?, extraInstructions?, audit?,
//                 availableToolGroups? }.
//                 With `audit`, one AuditEntry is recorded per call after it ends (PERM-8).
//                 `availableToolGroups` names groups usable for reasons outside the session
//                 (`semantic` while a search index exists, D80); asked once per turn.
//                 `tools` is every ToolDefinition the loop may offer; scoping picks the
//                 subset per round. Sub-agents call runTurn with their own context engine,
//                 a read-only tool list, and extraInstructions.
//   session       SessionState. `messages` is updated during the turn, and replaced by the
//                 context engine's compacted history after each prepareMessages (D51); `model`
//                 must be set; `reasoning` is sent with each request; the loop records
//                 switched-on tool groups in `activatedToolGroups`.
//   input         The user's text, or { text, attachments } (CLI-10).
//   signal        Aborting it cancels the model call and the running tool.
//
// Events: text and reasoning deltas, a tool-start / tool-end pair per call (tool-end carries
// `validity` for evals), and exactly one final turn-end with reason done, cancelled, error,
// or limit. The loop never throws; failures become turn-end "error".

export { measureFixedOverhead } from "./fixed-overhead.ts";
export { type RegisteredTool, ToolRegistry } from "./registry.ts";
export { buildSystemPrompt } from "./system-prompt.ts";
export { thinkCommand } from "./think-command.ts";
export { buildToolSchema } from "./tool-schema.ts";
export { mentionsDataFile, toolCallingStyleFor } from "./tool-scope.ts";
export { runTurn } from "./turn.ts";
export type {
  AgentDependencies,
  ToolCallingStyle,
  ToolReference,
  TurnInput,
} from "./types.ts";
