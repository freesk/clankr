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
| 1 | cli | [cli.md](specs/cli.md) | 1 | agent-cli | in progress | Argument parsing, one-shot mode, slash dispatcher; Ink REPL after |
| 2 | lmstudio | [lmstudio.md](specs/lmstudio.md) | 1 | agent-lmstudio | in progress | `LmClient` against the live server on localhost:1234; confirm streaming reports usage |
| 3 | agent-loop | [agent-loop.md](specs/agent-loop.md) | 1 | agent-loop | in progress | Registry and JSON schema generation from zod, then `runTurn` with `ScriptedLmClient` |
| 4 | context | [context.md](specs/context.md) | 1 | agent-context | in progress | On-disk `ResultStore` (JSON Lines rows), `capResult`, budgets |
| 5 | permissions | [permissions.md](specs/permissions.md) | 1 | agent-storage-permissions | in progress | `PathPolicy` with canonicalisation and the deny list, then the gate's decision table |
| 6 | storage | [storage.md](specs/storage.md) | 1 | agent-storage-permissions | in progress | Real `VixPaths` builder; then point `src/testing/temporary-vix-paths.ts` at it |
| 7 | search | [search.md](specs/search.md) | 1 | agent-search | in progress | Vendor step for ripgrep; `list_dir` and `read_file` first. Replace the smoke test in `src/tools/search/` |
| 8 | files | [files.md](specs/files.md) | 1 | agent-files | done (verified) | Merged in `c37d0ea`: 43 files tests; full suite 148 passing + 1 opt-in skipped, lint and build clean on main. Not verified: trashed file visible in `~/.Trash` (no Full Disk Access), cross-volume move fallback (EXDEV never triggered), behaviour against the real `PathPolicy` |
| 9 | image | [image.md](specs/image.md) | 1 | agent-image | done (verified) | Merged in `03bba17`: 30 image tests, full suite 50 passing, lint and build clean on main. Not verified: live LM Studio check (no `LM_API_TOKEN`), so default max edge and the image token estimate stay open |
| 10 | inspect | [inspect.md](specs/inspect.md) | 1 | agent-data | in progress | Format detection and the `.docx` parser; tabular profiling waits for task 11's engine module |
| 11 | sql | [sql.md](specs/sql.md) | 1 | agent-data | in progress | Vendor step for the DuckDB excel extension; locked engine module first, since inspect needs it |
| 12 | sandbox | [sandbox.md](specs/sandbox.md) | 1 | agent-sandbox | done (verified) | Merged in `d537642`: 55 sandbox tests incl. every escape, timeout, memory, and no-network case; full suite 105 passing, lint and build clean on main. Not verified: run through the real loop/permissions/model (wave 2) |
| 13 | chart | [chart.md](specs/chart.md) | 1 | agent-chart-pdf | in progress | Vendor step for Vega-Lite; theme loader and spec validation |
| 14 | pdf | [pdf.md](specs/pdf.md) | 1 | agent-chart-pdf | in progress | Vendor step for Chromium; offline `renderChart` |
| 15 | evals | [evals.md](specs/evals.md) | 1 | agent-evals | in progress | Task format and runner, tested with `ScriptedLmClient` |
| 16 | subagents | [subagents.md](specs/subagents.md) | 2 | unassigned | blocked | Waits for a working `runTurn` (task 3) |
| 17 | integration | [README.md](specs/README.md) | 2 | unassigned | blocked | Waits for wave 1; replace fakes one seam at a time |

## How wave 1 runs

- 12 agents, one per row owner above, each in its own git worktree on its own branch, started from the commit that adds `src/contracts/isolate.ts`.
- Paired parts share an agent where one consumes the other: storage + permissions, sql + inspect (inspect needs sql's engine), chart + pdf.
- Agents do not edit `ROADMAP.md`; the main session updates it as each agent reports.
- Shared files agents may touch, add-only: `package.json` (their own dependencies), `src/config/schema.ts` (new fields in their own section), `scripts/vendor/steps.ts` (their own step), their own spec. Contracts change only add-only, and the agent reports it.
- The main session merges each branch into `main` as it finishes, regenerates `package-lock.json` on conflict, and re-runs lint, test, and build after each merge.
- If a session dies: `git worktree list` and `git branch` show each agent's branch; anything committed there can be merged, and anything unfinished restarts from the row's next step.

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
| 2026-11-17 | Config `data.rowCap` is one number for the chart row cap and the isolate helper cap | specs/sandbox.md requires them to be defined once |
