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
| 1 | cli | [cli.md](specs/cli.md) | 1 | unassigned | todo | Argument parsing, one-shot mode, slash dispatcher; Ink REPL after |
| 2 | lmstudio | [lmstudio.md](specs/lmstudio.md) | 1 | unassigned | todo | `LmClient` against the live server on localhost:1234; confirm streaming reports usage |
| 3 | agent-loop | [agent-loop.md](specs/agent-loop.md) | 1 | unassigned | todo | Registry and JSON schema generation from zod, then `runTurn` with `ScriptedLmClient` |
| 4 | context | [context.md](specs/context.md) | 1 | unassigned | todo | On-disk `ResultStore` (JSON Lines rows), `capResult`, budgets |
| 5 | permissions | [permissions.md](specs/permissions.md) | 1 | unassigned | todo | `PathPolicy` with canonicalisation and the deny list, then the gate's decision table |
| 6 | storage | [storage.md](specs/storage.md) | 1 | unassigned | todo | Real `VixPaths` builder; then point `src/testing/temporary-vix-paths.ts` at it |
| 7 | search | [search.md](specs/search.md) | 1 | unassigned | todo | Vendor step for ripgrep; `list_dir` and `read_file` first. Replace the smoke test in `src/tools/search/` |
| 8 | files | [files.md](specs/files.md) | 1 | unassigned | todo | `write_file` and `edit_file` with previews |
| 9 | image | [image.md](specs/image.md) | 1 | unassigned | todo | `view_image` with `sharp` downscaling and the isolated sub-call |
| 10 | inspect | [inspect.md](specs/inspect.md) | 1 | unassigned | todo | Format detection and the `.docx` parser; tabular profiling waits for task 11's engine module |
| 11 | sql | [sql.md](specs/sql.md) | 1 | unassigned | todo | Vendor step for the DuckDB excel extension; locked engine module first, since inspect needs it |
| 12 | sandbox | [sandbox.md](specs/sandbox.md) | 1 | unassigned | todo | `runInIsolate` with limits and the escape tests |
| 13 | chart | [chart.md](specs/chart.md) | 1 | unassigned | todo | Vendor step for Vega-Lite; theme loader and spec validation |
| 14 | pdf | [pdf.md](specs/pdf.md) | 1 | unassigned | todo | Vendor step for Chromium; offline `renderChart` |
| 15 | evals | [evals.md](specs/evals.md) | 1 | unassigned | todo | Task format and runner, tested with `ScriptedLmClient` |
| 16 | subagents | [subagents.md](specs/subagents.md) | 2 | unassigned | blocked | Waits for a working `runTurn` (task 3) |
| 17 | integration | [README.md](specs/README.md) | 2 | unassigned | blocked | Waits for wave 1; replace fakes one seam at a time |

## Decisions made along the way

| Date | Decision | Reason |
|---|---|---|
| 2026-11-17 | Foundation built serially in the main session, no agents | Everything else is blocked on it, and it is small |
| 2026-11-17 | TypeScript 7.0, Biome, vitest 5, zod 4 | Current stable versions; Biome is one tool for lint and format |
| 2026-11-17 | D35 to D38 in the PRD (snapshot flag, `.xls` reader, pinned addon versions, DuckDB rebuild on registration) | Spike findings; details in [foundation.md](specs/foundation.md#spike-findings-2026-11-17) |
| 2026-11-17 | Contracts added beyond the spec sketch: `ToolDefinition.keyArgument`, `ChangePreview.targetPaths` and `dataSourcePaths`, `ResultStore.rowsFilePath`, `ToolContext.workingDirectory`, `AgentEvent` tool-end `validity` | Needed by the CLI tool line, permission classification, DuckDB reading row sets, relative paths, and the evals validity metric |
| 2026-11-17 | Config `data.rowCap` is one number for the chart row cap and the isolate helper cap | specs/sandbox.md requires them to be defined once |
