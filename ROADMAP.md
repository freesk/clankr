# ROADMAP

Recovery file for parallel work (CLAUDE.md rule 3). On resuming, read this first and continue from it. Update a row whenever its status changes, not at the end.

## Goal

Build `vix` as described in [PRD.md](PRD.md), part by part, following the waves in [specs/README.md](specs/README.md).

## Acceptance criteria

- Every part meets the "Done when" list in its spec, with observed evidence (CLAUDE.md rule 2).
- `npm run lint`, `npm test`, and `npm run build` pass on a clean checkout after every merge to `main`.
- Wave 1 parts import only `src/contracts/`, `src/config/`, and `src/testing/`, never each other (the one allowed exception: inspect uses sql's DuckDB engine module).
- Milestone exit criteria in PRD section 11 are checked end to end in wave 2.

## Status values

`todo` · `in progress` · `done (verified)` · `blocked`

## Tasks

| # | Part | Spec | Wave | Owner | Status | Next step |
|---|---|---|---|---|---|---|
| 0 | foundation | [foundation.md](specs/foundation.md) | 0 | main session | done (verified) | None. Evidence: lint, 16 tests, and build pass on a clean copy with `npm ci`; `npm run spike` prints a DuckDB result and an isolate result |
| 1 | cli | [cli.md](specs/cli.md) | 1 | agent-cli | done (verified) | Merged in `9e1f8ef`: 58 cli tests; one-shot never loads Ink (checked by a resolve hook); startup median 249 ms REPL, 81 ms one-shot. Not verified: anything against real parts (`src/cli/composition.ts` is a placeholder), wipe confirmation typed by hand, picker and approval views by eye. Re-measure startup after wiring |
| 2 | lmstudio | [lmstudio.md](specs/lmstudio.md) | 1 | agent-lmstudio | done (verified) | Merged in `6d1e8c5`; full suite 270 passing + 5 skipped. Verified live: token-missing and token-rejected errors against LM Studio 0.4.20. Not verified live (no `LM_API_TOKEN`): chat stream, usage in stream, SDK token counts, load/switch, reasoning toggle. Run `VIX_LIVE_LMSTUDIO=1 LM_API_TOKEN=… npx vitest run src/lmstudio/live.test.ts` |
| 3 | agent-loop | [agent-loop.md](specs/agent-loop.md) | 1 | agent-loop | done (verified) | Merged in `59acba2`: 58 agent tests; full suite 328 passing + 5 skipped. Not verified: CTX-5 with the real counter and tools (fake estimate 975 tokens native / 536 prompt), and whether Gemma follows `<tool_call>` |
| 4 | context | [context.md](specs/context.md) | 1 | agent-context | done (verified) | Merged in `d4792fe` and `dde0d78`: 43 context tests incl. the M2 criterion (scripted 50-turn session within the window at 16k and 8k); full suite 366 passing + 5 skipped. Not verified: real LM Studio token counts and template-overhead calibration, summary quality from a real model |
| 5 | permissions | [permissions.md](specs/permissions.md) | 1 | agent-storage-permissions | done (verified) | Merged in `dc8f650` with storage; full suite 238 passing then. Not verified: deny-list paths on a real home folder, audit entries written end to end by the agent loop |
| 6 | storage | [storage.md](specs/storage.md) | 1 | agent-storage-permissions | done (verified) | Merged in `dc8f650`: modes, wipe, resume, ephemeral cleanup on every exit path incl. signals, all tested in temp roots. Not verified: SIGHUP |
| 7 | search | [search.md](specs/search.md) | 1 | agent-search | done (verified) | Merged in `72c88bb`: 59 search tests (ripgrep vendored on main, 522 passing + 5 skipped). Whole-disk name search 160–405 ms for typical queries; content search 1.9–3.0 s warm on 10 GB (O6). Not verified: walk limits, abort, x64 ripgrep, SRCH-8 (P1, not built) |
| 8 | files | [files.md](specs/files.md) | 1 | agent-files | done (verified) | Merged in `c37d0ea`: 43 files tests; full suite 148 passing + 1 opt-in skipped, lint and build clean on main. Not verified: trashed file visible in `~/.Trash` (no Full Disk Access), cross-volume move fallback (EXDEV never triggered), behaviour against the real `PathPolicy` |
| 9 | image | [image.md](specs/image.md) | 1 | agent-image | done (verified) | Merged in `03bba17`: 30 image tests, full suite 50 passing, lint and build clean on main. Not verified: live LM Studio check (no `LM_API_TOKEN`), so default max edge and the image token estimate stay open |
| 10 | inspect | [inspect.md](specs/inspect.md) | 1 | agent-data | done (verified) | Merged in the sql+inspect merge: fixtures for every format, title-block headers, exact `.xls` dates, caching. 1M-row CSV profiled in 298 ms (peak 252 MB; 2M rows 283 MB); 107 MB `.xlsx` in 7.7 s. Not verified: an Excel-written 100 MB `.xlsx`, a large mixed-type sheet (likely over 10 s), UTF-16 CSV (refused) |
| 11 | sql | [sql.md](specs/sql.md) | 1 | agent-data | done (verified) | Merged with inspect; DuckDB Excel extension vendored on main; full suite 661 passing + 7 skipped. Every rejection case tested, 0 connections to a URL target, timeout and memory limits, spill into session scratch, rebuild on registration. 1M-row group-by 138 ms |
| 12 | sandbox | [sandbox.md](specs/sandbox.md) | 1 | agent-sandbox | done (verified) | Merged in `d537642`: 55 sandbox tests incl. every escape, timeout, memory, and no-network case; full suite 105 passing, lint and build clean on main. Not verified: run through the real loop/permissions/model (wave 2) |
| 13 | chart | [chart.md](specs/chart.md) | 1 | agent-chart-pdf | done (verified) | Merged in `65c20f5`: validation, theme, naming, row cap, self-check retry all tested with a fake isolate. Not verified: S8 end to end with the real isolate, reference-text budget with the real tokenizer, self-check with a real vision model |
| 14 | pdf | [pdf.md](specs/pdf.md) | 1 | agent-chart-pdf | done (verified) | Merged in `65c20f5`; vega and Chromium vendored on main, full suite 591 passing + 5 skipped. Offline proven (blocked requests logged, 0 leak connections, no sockets via `lsof`). Chart to PDF 853 ms cold, about 100 ms warm. Flaky under load: three browser tests timed out at 5 s while the machine was busy, passed in 0.1–1 s otherwise |
| 15 | evals | [evals.md](specs/evals.md) | 1 | agent-evals | done (verified) | Merged in `4b3d27d`: 41 golden tasks validated, runner and metrics tested with a scripted harness, network observers catch deliberate outbound traffic; full suite 409 passing + 5 skipped. Not verified: any golden run against a real model (real harness is wave 2), network test against real `vix`, PRD section 9 performance script (not built) |
| 16 | subagents | [subagents.md](specs/subagents.md) | 2 | agent-subagents | done (verified) | Merged in `683a17e`: 24 tests with the real `runTurn` (brief-only context, read-only tools, no nesting, turn limit, summary cap, cancellation); full suite 685 passing + 7 skipped. Not verified: a real model keeping to the cap. Integration agent told to wire `delegate` |
| 17 | integration | [README.md](specs/README.md) | 2 | agent-integration | done (verified) | Merged in `ca2ddea`: real parts wired (`src/app/`); 7 end-to-end tests (one-shot file turn, denied write, ephemeral, resume, inspect → SQL → PDF, delegate, /compact and /clear); full suite 693 passing + 7 skipped. Startup median 278 ms REPL, 199 ms one-shot (fake server). Not verified live: no `LM_API_TOKEN`. Built `vix -p` against the real server without a token prints the token-missing error and fix, exit 1 |
| 19 | CTX-5 fixed overhead | [context.md](specs/context.md) | 3 | agent-overhead | in progress | Real (LM Studio prompt_tokens, Gemma 12B): core 2,023, core+vision 2,191, all 2,717 vs target 1,500. Per tool: find_files 476, search_content 269, list_dir 177, make_chart 173, view_image 168, edit_file 150, read_result 146, inspect_data 144, read_file 131, run_js 124, move 117, copy 116, write_file 103, delegate 97, query_sql 85, delete 65, make_dir 57. Measure with `scripts/measure/fixed-overhead.ts` |
| 20 | `/config` setup flow | [cli.md](specs/cli.md) | 3 | agent-config | in progress | `vix config` and `/config`: walk through base URL, API token, default model (picked from LM Studio), context length, permission mode, allowed folders; save `~/.vix/config.json` at 0600; offer it on first run when the token is missing |
| 21 | Sample data in the repo | [evals.md](specs/evals.md) | 3 | agent-samples | done (verified) | Merged in `40d5202`: 6 files (sales_2025.csv, inventory.tsv, payroll_2025.xlsx, budget_legacy.xls, board_report.docx, survey_export.csv — an .xlsx named .csv), 194 KB, byte-identical regeneration across time zones; 20 tests incl. query_sql totals checked against generator data; suite 715 passing + 7 skipped. Not verified: opened in Excel/Word, README prompts against a real model |
| 22 | Live verification with Gemma 12B | — | 3 | main session | in progress | Done: lmstudio live tests pass (list, stream with usage — the server does report usage — and SDK token counts); real `vix -p` with Gemma 12B answered S2 correctly via list_dir → search_content (29 s incl. load); real MOD-8 load failure shown with its fix (e4b had to be unloaded for 12B to fit). Fixed: token counting on a trailing tool call; blocked fetch sometimes not logged (DATA-14). Open: one-shot cannot run execute-class tools at all (asked the user); golden run waits for tasks 19–21 |
| 23 | `--allow-data` for one-shot (D74) | [permissions.md](specs/permissions.md) | 3 | main session | todo | After task 20 merges (both touch `src/cli/arguments.ts`): add the flag, grant execute-class for data files inside allowed roots for the run, fix the denial text |
| 24 | inspect: real-world `.xlsx` typing bugs | [inspect.md](specs/inspect.md) | 3 | unassigned | todo | (1) Dates in a custom format (e.g. `yyyy-mm-dd`) are profiled as numbers, because DuckDB's Excel reader only knows built-in date formats. (2) A text column whose first cells are blank is typed as numbers and its text becomes NULL in SQL. Both found by the samples agent; samples avoid them |
| 18 | real eval harness and golden run | [evals.md](specs/evals.md) | 3 | unassigned | blocked | Waits for task 17; then implement `evals/runner/real-harness.ts` and run the golden suite against the model |

## How wave 1 runs

- 12 agents, one per row owner above, each in its own git worktree on its own branch, started from the commit that adds `src/contracts/isolate.ts`.
- Paired parts share an agent where one consumes the other: storage + permissions, sql + inspect (inspect needs sql's engine), chart + pdf.
- Agents do not edit `ROADMAP.md`; the main session updates it as each agent reports.
- Shared files agents may touch, add-only: `package.json` (their own dependencies), `src/config/schema.ts` (new fields in their own section), `scripts/vendor/steps.ts` (their own step), their own spec. Contracts change only add-only, and the agent reports it.
- The main session merges each branch into `main` as it finishes, regenerates `package-lock.json` on conflict, and re-runs lint, test, and build after each merge.
- If a session dies: `git worktree list` and `git branch` show each agent's branch; anything committed there can be merged, and anything unfinished restarts from the row's next step.

## How wave 3 runs

- User decisions 2026-11-17: the API token is entered through a `/config` setup flow (task 20); keep zod as is (D72); Gemma 4 12B QAT is now downloaded.
- Two agents in worktrees (tasks 20, 21). The main session does live checks (task 22) itself, so the token never goes into a file or an agent prompt.

## Next steps (after wave 2)

- Task 19 (CTX-5) can start now: real-tokenizer measurement needs `LM_API_TOKEN`; trimming can start against the estimate.
- Task 18 needs `LM_API_TOKEN` for the golden run. Without it, implement `evals/runner/real-harness.ts` and run against the fake server only.
- Smaller items: `renderReport` has no tool (DATA-19, P1); `delegate`'s nested tool-end events appear in one-shot `--json` `toolCalls` and could inflate eval metrics; the token-estimate warning prints once per run when the SDK rejects the token.

## How wave 2 runs

- Two agents in worktrees from `ee9f5cd`: agent-integration owns `src/cli/composition.ts`, cross-part fixes listed below, and dedupes; agent-subagents owns `src/subagent/` and adds `delegate` to nothing outside it (integration registers it).
- Integration registers `delegate` once subagents is merged; until then it leaves a clearly marked hook.

## Integration notes (for wave 2)

- `ToolContext` gained optional `model` and `reasoning` (from image). agent-loop must fill both from the session; without `model`, `view_image` refuses.
- image sends `ChatRequest.model` = `LoadedModel.instanceId`; lmstudio must accept that and map image parts to OpenAI `image_url` data URLs.
- chart's self-check (DATA-18) can reuse `prepareImage`, `buildImageRequest`, `askAboutImage` from `src/tools/image/`.

- Helpers in the isolate surface only `ToolError` messages to the model; chart's `render` must throw `ToolError` (chart agent told).
- Row sets stored by `save` record no source handles, so a preview reading a saved handle cannot trace it to a data file. Fixing it needs an add-only contract change (lineage in `ResultProvenance`).
- `run_js` previews omit `dataSourcePaths` when no data file is known; permissions must decide how D19 treats that (proposed: ask every time).
- `isolateLimitsFrom(config)` lives in `src/tools/data/run-js.ts`; chart should use it after integration. The 20-row preview constant there should be shared with `query_sql`.

- files: wire with `createFileTools(dependencies?)` and `createFileSlashCommands(vixPaths, dependencies?)`; `/undo` needs `VixPaths` because `SlashCommandContext` lacks it (consider adding it, add-only).
- files: `/undo` does not update the `ReadTracker`, so the model must re-read before overwriting an undone file. Small race between target check and `rename` in move/copy.
- Shared test fixtures inside a part go in `*.test-support.ts`, which the build excludes.

- storage/permissions wiring (cli): `openSession({ root: resolveVixRoot(), ephemeral, resumeSessionId })` and `close()` on exit; `--resume` = `new FileSessionStore(root).newest()` + `chooseResumeModel`; `vix wipe` = `wipe(root, …)`; gate = `new SessionPermissionGate({ session, paths: new RealPathPolicy({...}), prompter })` (no prompter in one-shot); register `permissionsCommand`.
- agent-loop must call `auditLog.record(...)` after every call incl. denied ones, with the gate's `basis`; build it with `createAuditLog({ vixPaths, ephemeral, secrets: [config.lmStudio.apiToken] })`.
- Read tools must call `PathPolicy.classify` themselves; the gate gets no preview for reads.
- lmstudio wiring: startup via `connectAtStartup({ client, switcher, session, modelKey, notify })`; `/model` via `createModelCommand(switcher)`; context subscribes via `switcher.onModelChanged`; cli must call `LmStudioClient.dispose()` on exit (SDK WebSocket keeps the process alive).
- `estimateTokens` in lmstudio duplicates the character counter in `src/testing/`; move to one runtime helper during integration.
- Risk: `npm audit` reports GHSA-mrhx-c7xc-m3w5 (zod < 4.6.6 memory exhaustion) through `@lmstudio/sdk`'s bundled zod 3.25.76. npm's only fix is downgrading the SDK to 0.3.0. Exposure is limited to messages from the local LM Studio server. Decide: accept, override, or drop the SDK for the character estimate.

- **Conflict to settle in integration:** `ChatRequest.model`. lmstudio and image use `LoadedModel.instanceId` (lmstudio maps it back to the key for profiles); agent-loop sends `model.key`. Change agent-loop to `instanceId`.
- Compaction write-back (D51, `dde0d78`): after every `prepareMessages` call the agent loop must set `session.messages = messages.slice(1)`. Storage's transcript writer must handle a replaced history (compaction and `/compact`).
- agent-loop wiring: `runTurn(dependencies, session, input, signal)` with `AgentDependencies` (`lm`, `context`, `permissions`, `tools`, `createToolContext(signal)`, `config`, `workingDirectory`, optional `toolReferences`, `extraInstructions`). `createToolContext` must fill `model` and `reasoning` (image needs them). cli warns on MOD-6 via `toolCallingStyleFor(model, config)`. Session creator sets `reasoning` from the model profile. Storage should persist `SessionState.activatedToolGroups`. Run `measureFixedOverhead` with real tools and the real counter for CTX-5.
- Chart must export a `ToolReference` (chart agent told).

- context wiring: `VixContextEngine({ lm, results, config, model? })`, `DiskResultStore(vixPaths.session.results)`, `createReadResultTool(config)`, `createContextCommands(engine)`. agent-loop must call `prepareMessages` before every model call (each tool round), send `maxTokens = engine.budgets().response`, and call `recordUsage` after each chat. lmstudio's switcher must call `engine.onModelChanged(model)`. agent-loop and cli must surface the error when system prompt plus tools exceed the window.

- evals wiring (wave 2): implement `evals/runner/real-harness.ts`: wrap the real client in `UsageRecordingLmClient`, allowed roots = task folder, auto-answer approvals, report registry tool names and slash commands, adapt `runTurn` with `bindRunTurn`, file tools with a private Trash (D54). Switch the runner from `createTemporaryVixPaths` to storage's layout if needed (the fake already uses it). Add `delete` golden tasks. Point `runUnderObservation` at real `vix`. Build the section 9 performance script.
- `TurnInput`/`RunTurn` now live in `src/contracts/turn.ts` with agent-loop's shape (`string | { text, attachmentPaths? }`); evals had defined a different one.

- **Contract merge:** three `TurnInput` shapes existed (agent-loop, evals, cli). Resolved in `src/contracts/turn.ts` to `string | { text, attachments?: Attachment[] }`, with cli's `Attachment { path, kind, label }`; agent-loop reads `attachments[].path`. The cli's proposed `SessionStore` (open/wipe) is renamed `SessionManager` because storage's `SessionStore` (list/load/newest) already had the name; storage implements the equivalent as `openSession` and `wipe`.
- cli wiring: everything goes through `src/cli/composition.ts`, which is a placeholder now (also hard-codes `~/.vix`; use storage's `resolveVixRoot`). `Harness.session()` is re-read after each command and turn, so `/model` and `/permissions` must mutate that state. `/model` gets the picker through `context.choose`.
- cli startup test runs `main.ts` with Node type stripping: no enums or constructor parameter properties in anything reachable from `main.ts`.
- `resultTokenCap` in search and sandbox comes from `defaultConfig()`, so a user's config override never reaches it. Integration: build tools from the loaded config.
- search wiring: `searchTools` from `src/tools/search/index.ts`; needs `npm run vendor -- ripgrep` (done on this machine). Its over-cap message says "page through it with read_result" — check the wording matches context's `read_result` parameters.
- Build excludes `src/**/testing` and `*.test-support.ts`. Search's `fixture-tree.ts` is still built; rename it to `.test-support.ts` in integration.

- chart/pdf wiring: `createMakeChartTool({ runInIsolate, createStandardHelpers, renderChart, renderPreview?, selfCheck? })`; renderer from `createChartRenderer({ idleMilliseconds: config.data.browserIdleSeconds * 1000, logBlocked })` with `logBlocked` → permissions' audit log; cli calls `renderer.close()` on exit. Self-check via `createVisionSelfCheck(() => session.model)` or image's sub-call. Pass `chartToolReference` to agent-loop's `toolReferences`. Merge `chartIsolateLimits(config)` with sandbox's `isolateLimitsFrom`. Dedupe `isPlainObject` (browser/fonts.ts, chart/spec-tree.ts). `renderReport` (DATA-19) has no tool yet.
- Fresh checkouts need `npm run vendor` (ripgrep, vega, chromium) or those tests skip themselves silently.
- Browser tests use vitest's 5 s default timeout; under load three of them timed out. Give browser tests a longer timeout in integration.

- sql/inspect wiring: register `querySqlTool` (`src/tools/data/query-sql.ts`) and `inspectDataTool` (`src/tools/data/inspect`); use `SessionDataSourceRegistry` from `src/data`, one per session (the engine is found by a `WeakMap` on it); call `closeSessionEngine(registry)` at session end; the real `ResultStore` (context's `DiskResultStore`) must implement `rowsFilePath`. Move `src/engines/duckdb/testing/on-disk-result-store.ts` to `src/testing/`.
- New add-only contract fields: `DataTable.layout` (`TableLayout`), `ResultProvenance.dataSourcePaths` (chart can use it for its output folder; sandbox's `save` lineage gap can use it too).
- `make-chart.render.test.ts` asserts cold and warm renders under 5 s inside the normal suite; it fails when the machine is loaded (seen with the 12B model and agents running). Move wall-clock assertions behind an opt-in perf flag.
- Load-sensitive tests: three browser tests and one isolate test failed only while the machine was busy. The isolate test now gets a 10 s limit; browser tests still need longer timeouts.

## Decisions made along the way

| Date | Decision | Reason |
|---|---|---|
| 2026-11-17 | Foundation built serially in the main session, no agents | Everything else is blocked on it, and it is small |
| 2026-11-17 | TypeScript 7.0, Biome, vitest 5, zod 4 | Current stable versions; Biome is one tool for lint and format |
| 2026-11-17 | D35 to D38 in the PRD (snapshot flag, `.xls` reader, pinned addon versions, DuckDB rebuild on registration) | Spike findings; details in [foundation.md](specs/foundation.md#spike-findings-2026-11-17) |
| 2026-11-17 | Contracts added beyond the spec sketch: `ToolDefinition.keyArgument`, `ChangePreview.targetPaths` and `dataSourcePaths`, `ResultStore.rowsFilePath`, `ToolContext.workingDirectory`, `AgentEvent` tool-end `validity` | Needed by the CLI tool line, permission classification, DuckDB reading row sets, relative paths, and the evals validity metric |
| 2026-11-17 | Wave 1 runs as 12 parallel agents in git worktrees | The user asked for parallel agents; worktrees keep `node_modules` and edits apart |
| 2026-11-17 | D39 (`sips` for HEIC/BMP) and D40 (AVIF accepted), from the image agent | `sharp` lacks those decoders; AVIF is free |
| 2026-11-17 | D41 (undo and cross-volume moves go through the Trash), from the files agent | Keeps FS-6's no-permanent-delete rule for every path |
| 2026-11-17 | D42–D47 from storage/permissions and lmstudio; O5 (`.env`) opened | See PRD 13.1 |
| 2026-11-17 | Renamed `src/lmstudio/fake-lm-studio-server.ts` to `.test-support.ts` | Keeps the fake out of `dist` |
| 2026-11-17 | D48–D50 from agent-loop | See PRD 13.1 |
| 2026-11-17 | Lint broke on main at `144a275` (long import after a rename), fixed in `ee2d841`; merge checks now use exit codes, not output tails | Rule 2: evidence must be the actual exit status |
| 2026-11-17 | D51 from context | See PRD 13.1 |
| 2026-11-17 | D52–D54 from evals | See PRD 13.1 |
| 2026-11-17 | Unified `TurnInput` in the contracts on agent-loop's shape | Two incompatible definitions had been merged |
| 2026-11-17 | D55–D58 from cli and search; O6 (cold vs warm content-search target) opened | See PRD 13.1 |
| 2026-11-17 | D59–D62 from chart and pdf | See PRD 13.1 |
| 2026-11-17 | Build also excludes `src/**/test-support.ts` | chart and browser test helpers use that exact name |
| 2026-11-17 | D63–D64 from sql and inspect. Wave 1 complete: all 15 parts merged | See PRD 13.1 |
| 2026-11-17 | D65 from subagents | See PRD 13.1 |
| 2026-11-17 | D66–D71 from integration. Wave 2 complete | See PRD 13.1 |
| 2026-11-17 | Config `data.rowCap` is one number for the chart row cap and the isolate helper cap | specs/sandbox.md requires them to be defined once |
