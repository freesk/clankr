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

## Open questions

None.
