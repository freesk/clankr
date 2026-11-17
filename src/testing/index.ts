// Fakes for testing a part against the contracts before the real parts exist.
// Test code only: excluded from the build.

export { NamedPermissionGate, PassThroughContextEngine } from "./agent-fakes.ts";
export {
  type AgentLoopKitOptions,
  collectEvents,
  createAgentLoopKit,
  createTestSession,
  toolCallBalance,
  toolMessageContents,
  toyReadTool,
  toyWrites,
  toyWriteTool,
} from "./agent-loop-kit.ts";
export { InMemoryResultStore } from "./in-memory-result-store.ts";
export { OnDiskResultStore } from "./on-disk-result-store.ts";
export { QueuedApprovalPrompter } from "./queued-approval-prompter.ts";
export {
  respond,
  ScriptedLmClient,
  type ScriptedResponse,
  testModel,
} from "./scripted-lm-client.ts";
export {
  FixedPathPolicy,
  InMemoryDataSourceRegistry,
  InMemoryReadTracker,
} from "./simple-fakes.ts";
export { createTemporaryVixPaths, type TemporaryVixPaths } from "./temporary-vix-paths.ts";
export { createTestToolContext, type TestToolContext } from "./test-tool-context.ts";
