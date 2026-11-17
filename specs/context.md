# Context engine

| | |
|---|---|
| **Wave** | 1 |
| **Milestone** | M0 (token ledger), M2 (the rest) |
| **Owns** | `src/context/` |

## Purpose

Keep a small model inside its window. This part counts tokens, caps tool results, stores what does not fit, evicts stale results, and summarizes old turns. The PRD calls this the core differentiator of the harness (section 5.6), and section 7 is its design.

## Requirements

- CTX-1, CTX-2, CTX-3, CTX-4, CTX-5: ledger, caps, `read_result`, compaction, fixed-overhead budget.
- CTX-9, CTX-10: stable prompt prefix, persistent memory.
- MOD-7, its share: recalculate budgets when the model changes; compact if the conversation no longer fits.
- SRCH-6 and DATA-9, the storage share: the full result behind a handle.
- PRD sections 7.1 and 7.2, techniques 1, 5, and 6.
- The compaction risk row in PRD section 12.

## Provides

- The `ContextEngine`: budgets, `capResult`, `prepareMessages`, `compact`, and a usage snapshot.
- The `ResultStore` implementation, on disk.
- The `read_result` tool.
- The `/context` and `/compact` slash commands.

## Consumes

| Contract | From | Fake until it exists |
|---|---|---|
| `LmClient.countTokens`, usage records | lmstudio | Scripted `LmClient` with a character-based counter |
| `LmClient.chat`, for the summary call | lmstudio | Scripted `LmClient` |
| Model-changed notification | lmstudio | Call the handler directly in tests |
| `VixPaths` (session result directory) | storage | Temporary `VixPaths` |

## Design notes

- **Budgets are fractions** of the loaded context length (PRD section 7.1), recomputed on every model change. No token count is hard-coded.
- **Two sources of counts.** Usage reported by a chat response is the truth for what was sent. Between calls, `countTokens` estimates what the next request will cost. The ledger reconciles the two after each call.
- **Capping.** `capResult` takes a tool's full output and its cap. Under the cap, it passes through. Over the cap, the full text goes to the store and the model gets a head and tail preview plus a handle.
- **Handles are short**, for example `r12`, because the model repeats them and every character costs tokens.
- **Two kinds of stored result.** Text (search hits, file listings) and row sets (query output, saved transforms). Row sets are read by the SQL engine, the isolate, and the chart renderer, so they share one on-disk format: JSON Lines, one row per line.
- **Provenance.** `ResultMeta` records which tool and arguments produced a result. [chart](chart.md) needs it to save the SQL next to the output (DATA-20).
- **Eviction.** Tool results older than 3 turns (configurable) are replaced by a one-line stub that keeps the handle.
- **Compaction.** At the threshold (70% in PRD section 7.2), first drop old tool results, then summarize older turns into a structured note with four fields: goal, facts found, files touched, open steps. Handles survive compaction.
- **Stable prefix (CTX-9).** System prompt and tool definitions come first and are never rewritten. Eviction and compaction change the middle of the message list, so they should happen at threshold crossings, not every turn.
- **Overflow is a bug.** "Sessions that hit a context overflow error: 0" is a PRD metric. `prepareMessages` must guarantee the request fits before it is sent, compacting as a last resort.

## Not in this part

- Deciding which tools are in scope (agent-loop).
- Where files physically live and whether the session is ephemeral (storage).
- Ranking and formatting of search results (search).
- Sub-agents (subagents).

## Done when

- `/context` shows usage by the four CTX-1 categories, and the totals match the usage LM Studio reports for the same request.
- An over-cap result is stored, previewed, and readable page by page and by search through `read_result`.
- Changing the context length in a test changes every budget proportionally.
- A scripted 50-turn session stays within the window the whole way (the M2 exit criterion), with eviction and compaction both observed.
- After compaction, a handle created before it still resolves.
- Switching to a model with a smaller window compacts the conversation instead of failing.

## Decisions

Settled 2026-11-17. A D-number means the decision is also recorded in PRD section 13.1.

| Topic | Decision |
|---|---|
| Row-set format on disk | JSON Lines, shared with [sql](sql.md) and [sandbox](sandbox.md) (D16). Dates are stored as ISO strings. |
| Eviction age | A tool result is replaced by its stub after 3 turns. Configurable. |
| Summary call | Reasoning is off. |

Settled while building (2026-11-17), internal to this part:

| Topic | Decision |
|---|---|
| Entry points | `VixContextEngine` (implements `ContextEngine`), `DiskResultStore` (implements `ResultStore`), `createReadResultTool(config)`, `createContextCommands(engine)`. The tool and commands are factories: the tool's cap comes from config, and a slash command's context does not carry the engine. |
| On-disk layout | `results/r12.txt` (text) or `results/r12.jsonl` (row set), plus `results/r12.meta.json` written last. A result without its metadata file was interrupted and is never served. Files 0600, directory 0700. |
| Handle numbering | The next number is one past the highest already in the results directory, so handles survive resume. A handle must match `r<number>`; anything else is rejected before a path is built. |
| Compaction write-back | `prepareMessages` returns the system prompt followed by the history to keep. The agent loop replaces `session.messages` with `messages.slice(1)` after every call, so compaction reaches the session and history does not grow without bound. Between threshold crossings the slice equals the input, so the write-back changes nothing. Documented on the contract (`src/contracts/context.ts`), no type change. |
| Compacted view | A fallback for a caller that does not write back: the engine never edits the caller's history itself. The engine remembers "the first N messages read as this shorter list" (checked by a hash of those N messages) and appends what came after. The view changes only at a threshold crossing, which keeps the prompt prefix stable (CTX-9). If the caller replaces its history (for example after `/compact`), the view resets. |
| Compaction steps | Above `compactionThreshold`: evict results older than `evictToolResultsAfterTurns`; if still above `compactionTarget`, summarize the oldest turns, keeping as many recent turns as fit under the target. If the request is still over the hard limit (window minus the response budget): evict all results but the latest round, then cut the largest messages in the middle. Only a system prompt plus tool definitions that alone exceed the window raises an error. |
| Note placement | The structured note is prepended to the first kept user message, not added as its own message, so roles still alternate for strict chat templates and the system prompt is never rewritten. |
| Note contents | The model writes goal, facts, and open steps. Files touched (paths from tool-call arguments) and stored handles (verified against the store) are added mechanically, so a handle survives compaction even if the model drops it. If the summary call fails, a mechanical note is used. |
| Token counting | Per-message counts from `LmClient.countTokens`, cached by message. Template overhead per message starts at 4 tokens and is replaced by the value measured from each reported usage. After a report, `/context` scales the categories to the reported total exactly. |
| `read_result` parameters | `handle`, `start_line`, `line_count`, `search` (case-insensitive substring). A page fills only up to the tool's own cap, measured with the real counter, so it is never stored again. A row set reads as one JSON row per line. |
| New config fields | `context.compactionTarget` (0.5) and `context.summaryShare` (0.08), both shares of the context length. |

## Open questions

None.
