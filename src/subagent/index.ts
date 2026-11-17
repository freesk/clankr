// subagents part (specs/subagents.md): `delegate` and the sub-agent runner (CTX-6, D18).
//
// Wiring: build the main tool list, then add
//   createDelegateTool({ config, tools, permissions, createToolContext?, onEvent?, onResult? })
// The sub-agent gets only the read tools from `tools` (never `delegate`), the same loaded
// model and result store (taken from the delegate call's ToolContext), a fresh
// VixContextEngine, and the main turn's signal. Its events go to `onEvent`; its tool-call ids
// are its own, so a renderer drawing them as nested lines must not mix them with the main turn's.

export { createDelegateTool, type DelegateToolDependencies } from "./delegate-tool.ts";
export { delegateToolName, ReadOnlyPermissionGate, readOnlyTools } from "./read-only-tools.ts";
export {
  runSubAgent,
  type SubAgentEnvironment,
  SubAgentError,
  type SubAgentLimits,
  type SubAgentResult,
  subAgentLimitsFrom,
  type ToolCallCounts,
} from "./run-sub-agent.ts";
export { type CappedSummary, capSummary } from "./summary-cap.ts";
