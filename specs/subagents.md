# Sub-agents

| | |
|---|---|
| **Wave** | 2 (needs the real agent loop) |
| **Milestone** | M2 |
| **Owns** | `src/subagent/` |

## Purpose

Let the model hand a broad task to a fresh context and get back a short summary. A search across three folders can read dozens of results; done in a sub-agent, only a capped summary enters the main conversation.

## Requirements

- CTX-6: delegation to a fresh context with its own tool subset and a capped summary.
- PRD section 7.2, technique 7, and section 7.3 (the delegation model).

## Provides

- One `ToolDefinition`, `delegate`, in the `core` group with `read` permission.
- `runSubAgent(brief, tools, limits)` returning a summary.

## Consumes

| Contract | From | Fake until it exists |
|---|---|---|
| `runTurn` | agent-loop | None: this part starts once the loop works |
| `ContextEngine`, a second instance for the sub-agent | context | In-memory fake |
| `PermissionGate` | permissions | Fake |

## Design notes

- **Same model, one at a time.** A sub-agent uses the loaded model. There is no second model (PRD section 7.3) and no concurrency: the main turn waits.
- **Fresh context.** The sub-agent starts with a system prompt and the task brief only. It sees none of the main conversation, so the brief must be self-contained; say so in the tool description.
- **Its own ledger.** The sub-agent gets its own context engine instance with the same window. Its tokens never count against the main conversation, but they are recorded for the tokens-per-task metric in PRD section 10.
- **Read-only tools.** A sub-agent's tool set is built from tools with `read` permission only, and `delegate` itself is never in it, which is how "sub-agents cannot spawn sub-agents" is enforced. Build the set from the permission class, not from a list of names, so a new write tool cannot slip in.
- **Turn limit.** The default is 8 turns. When the limit is reached, the sub-agent is asked for its summary with what it has, instead of failing with nothing.
- **The summary cap is hard.** Ask the model to stay within the cap (300 tokens by default), then truncate anyway. Handles in the summary stay valid, because the sub-agent shares the session's result store.
- **Permissions are not bypassed.** Every tool call inside a sub-agent goes through the same gate as in the main loop.
- **Visibility.** The sub-agent's tool calls are shown to the user as nested tool lines, so a long delegation is not a silent pause.
- **Cancellation** of the main turn cancels the sub-agent.

This part is not the isolated sub-call used by [image](image.md). That is a single model request with no tools. A sub-agent is a full loop.

## Not in this part

- The loop itself (agent-loop).
- Deciding when to delegate. That is the model's choice, guided by the tool description.
- Loading a second model, out of scope for v1.

## Done when

- A scripted sub-agent runs three tool calls and returns a summary; the main session's history contains the summary and none of the sub-agent's tool results.
- The sub-agent's tool list does not include `delegate`, or any tool with `write` or `execute` permission.
- A summary over the cap is truncated to it.
- Hitting the turn limit still produces a summary.
- A handle mentioned in the summary resolves from the main conversation.
- Cancelling the main turn stops the sub-agent.

## Decisions

Settled 2026-11-17. Both are recorded as D18 in PRD section 13.1.

| Topic | Decision |
|---|---|
| Can a sub-agent change files | No. In v1 a sub-agent gets read-only tools: the search and read tools and `read_result`. |
| Turn limit | 8 turns, configurable. |

Because sub-agents are read-only, no approval prompt can come from inside one.

## Open questions

None.
