# Agent loop

| | |
|---|---|
| **Wave** | 1 |
| **Milestone** | M0 |
| **Owns** | `src/agent/` |

## Purpose

The loop in the middle of the PRD architecture diagram: assemble the prompt, call the model, parse tool calls, check permission, run the tool, cap the result, repeat. It also owns the tool registry and the system prompt.

The loop is where the small-model accommodations live: forgiving parsing, corrective errors, and a retry limit. The harness owns this loop itself so that it controls exactly which messages are sent each round (PRD section 6.1).

## Requirements

- PRD section 6 (the loop) and section 6.2 (enforcing the tool contract).
- CTX-8: scoped tool sets.
- CTX-7, its share: reasoning text never enters history; the `/think` command.
- CTX-5, its share: the system prompt and tool definitions it writes must fit the fixed-overhead budget.
- MOD-6, its share: gate tools by capability; fall back to prompt-based tool calling.
- DATA-16, its share: load the Vega-Lite reference only while the chart tool is in use. The text belongs to [chart](chart.md).
- PERM-6: the registry contains no shell tool.
- SEC-7: file content is data, never instructions.
- The first risk row in PRD section 12 (malformed tool calls).

## Provides

- `runTurn(session, input, signal)` returning an `AgentEvent` stream.
- The tool registry: each tool part exports its `ToolDefinition`s; the registry collects them and generates the JSON schema sent to the model from the zod parameters.
- The system prompt.
- The `/think` slash command.

## Consumes

| Contract | From | Fake until it exists |
|---|---|---|
| `LmClient.chat` | lmstudio | Scripted `LmClient` |
| `ContextEngine` (`prepareMessages`, `capResult`, usage) | context | Pass-through fake with a fixed cap |
| `PermissionGate.check` | permissions | Fake that allows or denies by tool name |
| `ToolDefinition`s | every tool part | Two toy tools: one read, one write |

## Design notes

- **One round.** Ask context for the messages to send, call the model, collect text and tool calls, then for each call: validate, gate, run, cap, append. Stop when the model replies without a tool call, the turn is cancelled, or a limit is reached.
- **Lenient arguments.** Before rejecting a call, repair what can be repaired safely: a number sent as a string, a JSON object sent as a string, an unknown extra field. Validate with the tool's zod schema afterwards.
- **Corrective errors.** A rejected call returns a short message naming the tool, the bad field, and what was expected. No stack traces reach the model.
- **Limits.** A cap on consecutive invalid calls and a cap on tool rounds per turn. Hitting either ends the turn with reason `limit` and a message for the user.
- **Two tool-calling styles** behind one interface: native tool calls, and a prompt-based format parsed from text for models not trained for tool use. The per-model profile (MOD-9) picks the style.
- **Tool scoping.** Core tools are always present. The vision group is present only when the model reports vision. The data group is added once a data file is involved (PRD section 7.2), which the loop detects from file paths: `inspect_data` is itself a data tool, so the model cannot switch the group on by calling it. Activation changes the prompt prefix and costs one prompt-cache miss, which is accepted.
- **Reasoning.** Reasoning deltas are forwarded as events for display and dropped before the turn is stored.
- **Untrusted content.** Text read from files reaches the model only inside tool results. Nothing in a tool result can change the permission mode or grant approval.
- **Cancellation.** The abort signal reaches both the model call and the running tool. A cancelled tool call is recorded as cancelled so history stays well-formed.
- **First-attempt validity** is a PRD success metric (section 10). Emit enough in the events for [evals](evals.md) to count valid and repaired calls.

## Not in this part

- Token accounting, capping logic, eviction, and compaction (context). The loop calls them.
- The approval dialogue (permissions and cli).
- Sub-agents (subagents), which reuse `runTurn` with a different session and tool set.
- Any individual tool.

## Done when

With the scripted `LmClient` and toy tools:

- A text-only turn and a tool-calling turn both complete with the expected event sequence.
- A malformed call is repaired where possible; an unrepairable one gets a corrective error and the model's retry succeeds.
- The invalid-call limit and the round limit each end the turn.
- A denied call passes the user's feedback back to the model.
- Cancelling mid-tool ends the turn with reason `cancelled` and leaves valid history.
- No reasoning text is present in stored history.
- A model without vision is not offered `view_image`; a model without tool training uses the prompt-based style.
- The data tools are absent at session start and present on the round after a `.xlsx` path appears in a tool result.
- A test measures the system prompt plus core tool definitions with the real token counter and it is within the CTX-5 budget.

## Decisions

Settled 2026-11-17. A D-number means the decision is also recorded in PRD section 13.1.

| Topic | Decision |
|---|---|
| What activates the data group | Path detection. The loop adds the group when a path with one of the DATA-1 extensions appears in the user's message, an attachment, or a tool result (D15). |
| Prompt cache on activation | Accept one cache miss. Tool definitions stay in the standard tools field, so native tool calling keeps working (D15). |
| Removing the Vega-Lite reference | After 3 turns without a `make_chart` call, the same age as stale-result eviction in [context](context.md). |

## Open questions

None.
