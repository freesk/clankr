# clankr workstream specs

These specs split the build described in [PRD.md](../PRD.md) into parts that can be built mostly in parallel.

The PRD stays the source of truth for **what** is required. A spec says **who builds it, where it lives, and what it promises to the other parts**. Specs cite requirement IDs instead of restating them. If a spec and the PRD disagree, the PRD wins and the spec is fixed in the same change.

Interfaces and file paths in these specs are proposals until the code exists. Once `src/contracts/` is written, the code is the source of truth for every shared type.

## Parts

| Spec | Builds | Owns | Milestone | Wave |
|---|---|---|---|---|
| [foundation.md](foundation.md) | Project scaffold, shared contracts, config, test fakes, native-addon spike | `src/contracts/`, `src/config/`, `src/testing/`, `scripts/` | M0 | 0 |
| [cli.md](cli.md) | REPL, one-shot mode, slash command dispatch, rendering, approval prompts | `src/cli/` | M0 | 1 |
| [lmstudio.md](lmstudio.md) | LM Studio client: models, load/unload, streaming chat, token counts, `/model` | `src/lmstudio/` | M0 | 1 |
| [agent-loop.md](agent-loop.md) | The turn loop, tool registry, tool-call parsing, tool scoping | `src/agent/` | M0 | 1 |
| [context.md](context.md) | Token ledger, result store, caps, eviction, compaction, `read_result` | `src/context/` | M0, M2 | 1 |
| [permissions.md](permissions.md) | Permission modes, path policy, deny list, audit log | `src/permissions/` | M1 | 1 |
| [storage.md](storage.md) | `~/.clankr/` layout, sessions, resume, `clankr wipe`, `--ephemeral` | `src/storage/` | M0, M5 | 1 |
| [search.md](search.md) | `find_files`, `search_content`, `list_dir`, `read_file` | `src/tools/search/` | M1 | 1 |
| [files.md](files.md) | `write_file`, `edit_file`, `make_dir`, `move`, `copy`, `delete`, `/undo` | `src/tools/fs/` | M1 | 1 |
| [image.md](image.md) | `view_image` with downscaling and an isolated sub-call | `src/tools/image/` | M3 | 1 |
| [inspect.md](inspect.md) | `inspect_data`: format detection and profiles for spreadsheets and `.docx` | `src/tools/data/inspect/`, `src/data/` | M4 | 1 |
| [sql.md](sql.md) | `query_sql` and the locked-down DuckDB engine | `src/engines/duckdb/`, `src/tools/data/query-sql.ts` | M4 | 1 |
| [sandbox.md](sandbox.md) | `run_js` and the V8 isolate engine | `src/engines/isolate/`, `src/tools/data/run-js.ts` | M4 | 1 |
| [chart.md](chart.md) | `make_chart`: chart code to a validated, themed Vega-Lite spec | `src/chart/`, `src/tools/data/make-chart.ts` | M4 | 1 |
| [pdf.md](pdf.md) | Offline headless browser that renders a spec to PDF, PNG, or SVG | `src/engines/browser/` | M4 | 1 |
| [output.md](output.md) | Output formats, how the user chooses one, the Word and Excel writers, `export_table`, `/format` | `src/output/`, `src/tools/data/export-table.ts` | M4 | 4 |
| [evals.md](evals.md) | Golden task suite, metrics, and the no-network test | `evals/`, `test/network/` | M5 | 1 |
| [subagents.md](subagents.md) | `delegate` and the sub-agent runner | `src/subagent/` | M2 | 2 |
| [semantic-search.md](semantic-search.md) | `clankr index`, `/index`, and `search_meaning`: search by meaning over indexed folders | `src/semantic/` | after M5 | 4 |

Milestones in the PRD describe the order in which scenarios must pass. Waves describe the order in which work can start. A part in wave 1 can be built and unit-tested long before its milestone's exit criteria are checked end to end.

## Waves

```
Wave 0   foundation ── scaffold · contracts · config · fakes · spike
            │            (serial; everything below is blocked on it)
            ▼
Wave 1   cli        lmstudio    agent-loop   context    permissions   storage
         search     files       image        evals
         inspect    sql         sandbox      chart      pdf
            │            (parallel; each part tests against contracts and fakes)
            ▼
Wave 2   subagents ── needs the real agent loop
         integration ── replace fakes with real parts, one seam at a time
         golden suite run ── PRD section 10 metrics
```

Wave 1 parts do not import each other's implementations. They import `src/contracts/` and the fakes in `src/testing/`. That rule is what keeps them parallel.

There is one exception inside wave 1. [inspect](inspect.md) profiles tabular files through the DuckDB engine that [sql](sql.md) builds, and a database engine cannot usefully be faked. The rest of inspect starts at once; its tabular profiling starts when the engine module exists.

## Seams

Each row is a place where two parts meet. The contract named here is defined in [foundation.md](foundation.md). A seam is the first place to look when integration fails.

| Seam | Contract | Produced by | Used by |
|---|---|---|---|
| Rendering a turn | `AgentEvent` stream | agent-loop | cli, evals |
| Asking for approval | `ApprovalPrompter` | cli | permissions |
| Gating a tool call | `PermissionGate` | permissions | agent-loop |
| Checking a path | `PathPolicy` | permissions | search, files, image, inspect, chart |
| Talking to the model | `LmClient` | lmstudio | agent-loop, context, image, cli |
| Defining a tool | `ToolDefinition` | every tool part | agent-loop |
| Capping a result | `ContextEngine.capResult` | context | agent-loop |
| Storing a large result | `ResultStore` | context | search, sql, sandbox, chart, inspect |
| "Was this file read?" (FS-1) | `ReadTracker` | search (`read_file`) | files (`write_file`) |
| Previewing a change (FS-7) | `ChangePreview` | files, sql, sandbox, chart | permissions, cli |
| Naming a data file in SQL | `DataSourceRegistry` | inspect | sql, sandbox, chart |
| Profiling a tabular file | The DuckDB engine module | sql | inspect |
| Running model-written JS | `runInIsolate` | sandbox | chart |
| Turning a spec into a file | `renderChart` | pdf | chart |
| Choosing the output format | `OutputFormatContext` on `ToolContext`, `OutputFormatPrompter` | output (the order), cli (the picker) | chart, output |
| Printing a table, drawing a picture for a document | `renderTable`, `renderChartImage` | pdf | output, chart |
| Where a session writes | `ClankrPaths` | storage | context, permissions, files, sql |
| Registering a slash command | `SlashCommand` | lmstudio, context, permissions, files, agent-loop | cli |
| Turning text into vectors | `LmClient.embed` | lmstudio | semantic-search |
| Building or removing a search index | `IndexRequest`, `IndexRunOptions` | semantic-search | cli |
| Offering a tool group from outside the session | `AgentDependencies.availableToolGroups` | semantic-search (through app) | agent-loop |

## Requirements that span parts

Most requirement IDs belong to one spec. These are split, and each spec states its share.

| ID | Split |
|---|---|
| CLI-3 | cli dispatches; each command's behaviour belongs to the part that owns the feature (table in [cli.md](cli.md)) |
| CLI-6, CLI-7, CLI-9 | cli parses the flag or subcommand; storage does the work |
| MOD-6 | lmstudio reports capabilities; agent-loop gates tools and picks the tool-calling style |
| MOD-7 | lmstudio announces the model change; context recalculates budgets and compacts |
| SRCH-6 | search ranks and formats; context stores the full set behind a handle |
| SRCH-9 | semantic-search indexes and queries; lmstudio embeds; storage owns the index location and wipes it; agent-loop offers the tool only while an index exists; cli parses `clankr index` and `/index` |
| FS-7 | files builds the preview; permissions decides whether to show it; cli draws it |
| CTX-7 | lmstudio sends the reasoning setting; agent-loop strips reasoning from history and owns `/think` |
| DATA-9 | sql and sandbox each enforce their own limits; context stores the result |
| DATA-13 | output owns the list of formats; pdf draws PDF, PNG, and SVG; output writes Word and Excel files |
| DATA-15 | chart applies palette and fonts to the spec; pdf applies page size, logo, and footer; output applies page size, font, and footer to a Word document |
| DATA-22 | output owns the order; cli parses `--format` and lends the picker; chart and output's `export_table` call it |
| PERM-6 | agent-loop's registry has no shell tool; evals asserts it |
| SEC-3 | foundation sets the vendoring convention; search, sql, chart, and pdf each vendor their own assets |
| SEC-4 | sql, sandbox, and pdf each prove their own isolation; evals runs the whole-process network test |
| SEC-7 | agent-loop keeps file content in tool results only; permissions never reads grants from content |

## Spec layout

Every spec has the same sections, so a reader can jump to the one they need.

- **Purpose**: what the part is for, in a few sentences.
- **Requirements**: the PRD IDs it satisfies.
- **Provides**: what other parts may call.
- **Consumes**: what it needs from other parts, and what to fake until they exist.
- **Design notes**: constraints and decisions the PRD leaves to this part.
- **Not in this part**: things a reader might expect here that live elsewhere.
- **Done when**: evidence that must be observed before the part is called done ([CLAUDE.md](../CLAUDE.md) rule 2).
- **Decisions**: questions that were open and are now settled. A decision that changes what the product does, or what the PRD says, also has a row in PRD section 13.1 and carries its D-number here. A decision internal to one part is recorded only in that part's spec.
- **Open questions**: decisions still to be made. When one is settled, move it to Decisions.

## What is still open

The first round of open questions was settled on 2026-11-17. What remains:

| Spec | Question | Settled by |
|---|---|---|
| [image.md](image.md) | What is the default maximum image edge? | A measurement in M3 |
| [search.md](search.md) | Which text extractors does the SRCH-8 fallback use, and what bounds it? | A choice |
| [semantic-search.md](semantic-search.md) | The embedding model's real key and speed, and whether Gemma 12B picks `search_meaning` | The live test and a live turn |
| [chart.md](chart.md) | Where does a chart built from several data files go, and does the automatic retry count as an attempt? | A choice |

## Before starting parallel agents

[CLAUDE.md](../CLAUDE.md) rule 3 requires a `ROADMAP.md` in the repo root before parallel agents start. Build it from the parts table above: one task per spec, with its owner, status, and next step.
