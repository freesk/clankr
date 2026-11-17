// context part. See specs/context.md.
// Token ledger, result store, caps, eviction, compaction, read_result, /context and /compact.
//
// Compaction write-back: `engine.prepareMessages(input)` returns `[systemPrompt, ...history]`,
// where `history` is what the session should now keep (compacted when a threshold was crossed,
// otherwise identical to `input.history`). After every call, the agent loop sets
// `session.messages = messages.slice(1)`. `/compact` replaces `session.messages` itself.
// `capResult` accepts any text, including short corrective error messages, which pass through.

export { computeBudgets, computeWindowLimits, type WindowLimits } from "./budgets.ts";
export { ClankrContextEngine, type ContextEngineOptions } from "./context-engine.ts";
export { DiskResultStore, UnknownResultError } from "./disk-result-store.ts";
export { isResultHandle } from "./handles.ts";
export { createReadResultTool } from "./read-result-tool.ts";
export { createContextCommands } from "./slash-commands.ts";
