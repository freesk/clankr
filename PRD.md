# PRD: vix, a local LLM harness

| | |
|---|---|
| **Status** | Draft v0.4 (foundation built; native-addon spike findings recorded) |
| **Last updated** | 2026-11-17 |
| **CLI name** | `vix` (after Vixen, Santa's smartest reindeer) |

## 1. Summary

`vix` is a command-line agent harness, written in TypeScript on Node.js, that drives a small local model hosted by LM Studio. It lets the user search their file system, create and edit text files and folders, read images, and turn local spreadsheets and Word documents into charts and PDF reports.

Everything runs on the user's machine. The data it is built for is sensitive and must never leave the computer, which is the reason for using a local model at all.

The target model is small (Gemma 4 12B QAT), so the harness is designed around a tight context budget: deterministic code does the heavy work, and the model only sees compact, bounded summaries of it.

## 2. Goals and non-goals

### Goals

1. Find files anywhere on the computer by name, metadata, or content, fast.
2. Create and edit text files and folders safely, with user approval for changes.
3. Read image content (describe, transcribe text, answer questions about an image).
4. Switch between models available in LM Studio with a `/model` command.
5. Keep a small model effective through aggressive context optimization and delegation.
6. Build charts and graphs from large local spreadsheets and `.docx` files, exported as PDF, without the full data set entering the model context or leaving the machine.

### Non-goals (v1)

- Cloud model providers or any hosted inference.
- Web search, web fetch, or any tool that makes outbound network requests.
- Shell command execution by the model, in any form.
- A GUI, IDE extension, or web interface.
- Editing binary office files in place (writing back to `.xlsx` / `.docx`).
- PDF, PowerPoint, and scanned images as chart data sources.
- Bulk rename by pattern, and zip / unzip.
- Multi-user or remote use. The harness talks to LM Studio on `localhost` only.
- Windows and Linux support. v1 is macOS only.

## 3. Users and scenarios

Primary user: a single technical user working on their own Mac, with data they cannot upload to a hosted service.

| # | Scenario | Example prompt |
|---|---|---|
| S1 | Find files by name or metadata | "Find the lease PDF I downloaded last spring" |
| S2 | Find files by content | "Which notes mention the Q3 vendor renewal?" |
| S3 | Create files and folders | "Create a `2026-taxes` folder with a checklist.md inside" |
| S4 | Edit text files | "In config.yaml, change the port to 8080" |
| S5 | Reorganize | "Move every screenshot from Desktop into Pictures/Screenshots" |
| S6 | Read an image | "What does this receipt say?" |
| S7 | Understand a data file | "What's in payroll_2025.xlsx?" |
| S8 | Chart from a spreadsheet | "Chart monthly headcount by department as a stacked bar, save as PDF" |
| S9 | Chart from a document | "Plot the second table in the board report" |
| S10 | Switch model | `/model` then pick from the list |

## 4. Product principles

1. **Local only.** No outbound network traffic from the harness, its tools, or anything it spawns. This is a hard requirement, not a default.
2. **Code does the work, the model decides.** Searching, parsing, aggregating, and rendering are done by deterministic code. The model picks tools and writes short queries and snippets.
3. **Every token is budgeted.** Tool results are bounded, large outputs live on disk behind a handle, and tool definitions are only loaded when relevant.
4. **Full data sets stay out of the context.** For spreadsheets and documents the model sees schema, statistics, and a few sample values; never the full contents.
5. **Changes need consent.** Reads are free; writes, moves, deletes, and code execution are gated by a permission mode.
6. **Design for the small model.** Few tools, short descriptions, flat schemas, forgiving parsing, and errors that tell the model what to do next.

## 5. Functional requirements

Priorities: **P0** = required for v1, **P1** = should have, **P2** = later.

### 5.1 CLI

| ID | Requirement | Pri |
|---|---|---|
| CLI-1 | Interactive REPL started with `vix`, with streamed model output. | P0 |
| CLI-2 | One-shot mode: `vix -p "prompt"` prints the result and exits with a status code. Accepts piped stdin. | P0 |
| CLI-3 | Slash commands: `/model`, `/context`, `/compact`, `/clear`, `/think`, `/permissions`, `/help`, `/exit`. | P0 |
| CLI-4 | Tool calls are shown as one compact line each (tool, key argument, result size, duration). | P0 |
| CLI-5 | `Ctrl+C` cancels the current generation or tool run without exiting; a second press exits. | P0 |
| CLI-6 | `vix wipe` deletes all saved sessions, stored tool results, and logs. | P0 |
| CLI-7 | `--ephemeral` runs a session that leaves nothing on disk when it exits. | P0 |
| CLI-8 | A status line shows the active model, context used versus available, and permission mode. | P1 |
| CLI-9 | Sessions are saved to disk and can be resumed with `vix --resume`. | P1 |
| CLI-10 | Image and file paths can be attached by typing or dragging a path into the prompt. | P1 |
| CLI-11 | `--json` output for one-shot mode, for scripting. | P2 |

Configuration, sessions, and the theme file live in `~/.vix/`.

### 5.2 Model management

| ID | Requirement | Pri |
|---|---|---|
| MOD-1 | Connect to LM Studio at a configurable base URL (default `http://localhost:1234`). | P0 |
| MOD-2 | Support LM Studio API tokens through the `LM_API_TOKEN` environment variable or config file. The token is never logged or placed in model context. | P0 |
| MOD-3 | `/model` lists models pulled live from `GET /api/v1/models`, filtered to `type: "llm"`, showing name, parameter size, quantization, max context, loaded state, and vision / tool-use / reasoning capability. | P0 |
| MOD-4 | Selecting a model loads it if needed, with the configured context length (default 16,384 tokens), and switches the session to it. A model already loaded with a different context length is reloaded with the configured one. `/model <key>` switches directly. | P0 |
| MOD-5 | The default model is `google/gemma-4-12b-qat`, overridable in config and with `--model`. | P0 |
| MOD-6 | Capabilities gate features: models without vision do not get the image tool; models not trained for tool use produce a warning and fall back to prompt-based tool calling. | P0 |
| MOD-7 | Context budgets are recalculated from the loaded context length whenever the model changes. On switch, the conversation is compacted if it no longer fits. | P0 |
| MOD-8 | Clear startup errors with a fix for each: LM Studio not running, token missing or rejected, model not downloaded, model failed to load. | P0 |
| MOD-9 | Per-model profiles in config: sampling parameters, context length, reasoning setting, tool-calling style. | P1 |
| MOD-10 | Optionally unload the previous model on switch to free memory. | P1 |

### 5.3 File system search (primary use case)

| ID | Requirement | Pri |
|---|---|---|
| SRCH-1 | `find_files`: search by name pattern (glob), type, size range, and modified/created date range, across the whole machine. With no root given it searches the home folder. | P0 |
| SRCH-2 | Whole-disk name and metadata queries use the macOS Spotlight index (`mdfind`) so they return in well under a second. Falls back to a directory walk where the index is unavailable. | P0 |
| SRCH-3 | `search_content`: regex or literal search inside files under a given root, backed by ripgrep. | P0 |
| SRCH-4 | `list_dir`: list a directory with type, size, and modified time. Optional depth-limited tree. | P0 |
| SRCH-5 | `read_file`: read a text file by line range, with line numbers. Refuses binary files with a pointer to the right tool. | P0 |
| SRCH-6 | Results are ranked (recency, path depth, match quality), capped at a fixed count, and returned in a compact format. The full result set is stored behind a handle the model can page through. | P0 |
| SRCH-7 | Default excludes: `node_modules`, `.git`, `Library/Caches`, system directories, and other noise. Overridable per call. | P0 |
| SRCH-8 | Content search inside documents (PDF, `.docx`, `.xlsx`) through Spotlight's content index, falling back to local text extraction where content is not indexed. | P1 |
| SRCH-9 | Semantic search over a user-chosen folder using a local embedding model in LM Studio. | P2 |

### 5.4 Create and edit files and folders

| ID | Requirement | Pri |
|---|---|---|
| FS-1 | `write_file`: create a new text file, creating parent folders as needed. Overwriting an existing file requires that it was read in this session. | P0 |
| FS-2 | `edit_file`: exact string replacement (`old` → `new`), with an option to replace all occurrences. Fails with a helpful message when the match is missing or ambiguous. | P0 |
| FS-3 | `make_dir`: create a folder, including intermediate folders. | P0 |
| FS-4 | `move`: move or rename a file or folder. Refuses to overwrite an existing target. | P0 |
| FS-5 | `copy`: duplicate a file or a whole folder tree to a new location. Refuses to overwrite an existing target. | P0 |
| FS-6 | `delete`: moves the target to the macOS Trash. Nothing is ever permanently deleted. | P0 |
| FS-7 | Every change is shown to the user as a diff or a one-line summary before it is applied (subject to permission mode). | P0 |
| FS-8 | Whitespace-tolerant matching for `edit_file` when the exact match fails, since small models often get indentation wrong. | P1 |
| FS-9 | `/undo` reverts the last file change made in the session, from a local snapshot. | P1 |
| FS-10 | `move` and `copy` accept a list of sources, so many files are handled in one tool call with one approval. | P1 |

### 5.5 Image reading

| ID | Requirement | Pri |
|---|---|---|
| IMG-1 | `view_image`: send a local JPEG, PNG, or WebP image to the model with a question. | P0 |
| IMG-2 | Images are downscaled before sending, to a configurable maximum edge, to control token cost. | P0 |
| IMG-3 | Image analysis runs in an isolated sub-call. Only the text answer returns to the main conversation; the image tokens never stay in history. | P0 |
| IMG-4 | Other formats (HEIC, GIF, TIFF, BMP) are converted locally first. | P1 |
| IMG-5 | A "transcribe" mode tuned for extracting text from screenshots, receipts, and scans. | P1 |
| IMG-6 | Crop/zoom: the model can request a region of a large image at higher resolution. | P2 |
| IMG-7 | PDF pages rendered to images for scanned documents. | P2 |

### 5.6 Context optimization and delegation

This is the core differentiator of the harness. See [section 7](#7-context-strategy) for the design.

| ID | Requirement | Pri |
|---|---|---|
| CTX-1 | A token ledger tracks context use by category (system, tool definitions, history, tool results) using real token counts from LM Studio. `/context` displays it. | P0 |
| CTX-2 | Every tool result has a hard token cap. Output over the cap is written to a local store and replaced by a head/tail preview plus a handle. | P0 |
| CTX-3 | `read_result`: page through or search a stored result by handle. | P0 |
| CTX-4 | Automatic compaction when usage crosses a threshold: first drop old tool results, then summarize older turns. `/compact` triggers it manually. | P0 |
| CTX-5 | The fixed overhead (system prompt plus tool definitions) stays under a set budget, target ≤ 1,500 tokens. | P0 |
| CTX-6 | Sub-agents: a task can be delegated to a fresh context with its own tool subset. Only a short, capped summary returns. | P0 |
| CTX-7 | Reasoning ("thinking") is configurable per model and with `/think`. Reasoning text is never kept in history. | P0 |
| CTX-8 | Tool sets are scoped: only tools relevant to the current task are exposed to the model. | P1 |
| CTX-9 | The prompt prefix is kept stable between turns so LM Studio can reuse its prompt cache. | P1 |
| CTX-10 | Persistent memory: a small, capped notes file the user and model can add to, loaded at session start. | P2 |

### 5.7 Data, charts, and PDF output

The data path has four steps, each a separate tool:

```
file ──► inspect_data ──► query_sql ──► run_js (optional) ──► make_chart ──► PDF
         profile only     DuckDB on     reshape in a          Vega-Lite spec built
         reaches model    the host      V8 isolate            in the isolate, rendered
                                                              in an offline browser
```

**Inspecting data**

| ID | Requirement | Pri |
|---|---|---|
| DATA-1 | `inspect_data`: identify a file's real format (by content signature, not only extension) and return a compact profile. Supported: `.xlsx`, `.xls`, `.csv`, `.tsv`, `.docx`. | P0 |
| DATA-2 | Spreadsheet profile: sheets, dimensions, detected header row, and per column the inferred type, null count, distinct count, min/max, and 3 real sample values. | P0 |
| DATA-3 | Document profile (`.docx`): heading outline, and each table with its position, dimensions, and header row. | P0 |
| DATA-4 | Profiling streams the file and handles at least 1,000,000 rows or 500 MB without loading it all into memory. | P0 |
| DATA-5 | Sample values can be masked for columns the user marks as sensitive. | P2 |

**Querying and transforming**

| ID | Requirement | Pri |
|---|---|---|
| DATA-6 | `query_sql`: run a read-only SQL query over an inspected file using embedded DuckDB on the host. This is the main path for filtering, grouping, and aggregating. | P0 |
| DATA-7 | DuckDB is locked down: `SELECT` statements only, file access limited to the inspected input files, extension install and autoload disabled. Its Excel reader is vendored at install time. | P0 |
| DATA-8 | `run_js`: execute model-written JavaScript in a V8 isolate (`isolated-vm`). The isolate has no file system, network, process, or module-loading APIs. It reaches data only through injected helpers such as `data(handle)` and `save(name, rows)`. | P0 |
| DATA-9 | `query_sql` and `run_js` have time, memory, and output-size limits. The full result is stored behind a handle; only a capped preview returns to the model. | P0 |

**Charts and PDF**

| ID | Requirement | Pri |
|---|---|---|
| DATA-10 | `make_chart`: the model writes JavaScript that builds a Vega-Lite spec and calls `render(spec, data(handle))`. There is no separate declarative chart tool. | P0 |
| DATA-11 | Chart code runs in the same V8 isolate as `run_js`. The resulting spec is validated against the Vega-Lite schema, and errors are returned to the model as short, fixable messages. | P0 |
| DATA-12 | Rendering happens in a headless browser page that contains only vendored Vega-Lite, the validated spec, and the data. Model-written code never executes in the browser. | P0 |
| DATA-13 | Output is PDF by default. PNG and SVG export are also available. | P0 |
| DATA-14 | The headless browser runs fully offline. All outbound requests are blocked and logged. | P0 |
| DATA-15 | Styling comes from `~/.vix/theme.json`: palette, fonts, page size, and an optional logo and footer. The harness applies it to every chart; the model does not set styling. A built-in default theme is used when the file is absent. | P0 |
| DATA-16 | A short Vega-Lite reference with worked examples is added to the context only while the chart tool is in use. | P0 |
| DATA-17 | Rows passed to a chart are capped (default 50,000). Above the cap, the tool tells the model to aggregate with `query_sql` first. | P0 |
| DATA-18 | After rendering, the harness can show the chart image to the model to self-check, on vision-capable models. A failed check triggers one automatic retry. | P1 |
| DATA-19 | Multi-chart reports: several charts and text blocks composed into one PDF. | P1 |
| DATA-20 | The SQL, chart code, and final spec are saved next to the output so a chart can be reproduced without the model. | P1 |

### 5.8 Permissions and safety

| ID | Requirement | Pri |
|---|---|---|
| PERM-1 | Three permission modes: **ask** (default, confirm each change), **auto-edit** (file changes inside allowed roots are automatic), **read-only**. | P0 |
| PERM-2 | Read-only tools never prompt. | P0 |
| PERM-3 | Writes are limited to configured allowed roots (default: the directory `vix` was started in). Writing elsewhere always asks. | P0 |
| PERM-4 | A deny list of protected paths that are never read or written: `~/.ssh`, keychains, browser profiles, credential files, system directories. | P0 |
| PERM-5 | `delete` and the execute-class tools (`query_sql`, `run_js`, `make_chart`) ask unless explicitly allowed for the session. | P0 |
| PERM-6 | There is no shell tool. The model cannot run arbitrary commands. | P0 |
| PERM-7 | Approval prompts offer: once, always for this session, or deny with feedback that is passed back to the model. | P1 |
| PERM-8 | A local audit log of every tool call, its arguments, and its outcome. | P1 |

## 6. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  CLI (REPL / one-shot)      slash commands · rendering       │
├──────────────────────────────────────────────────────────────┤
│  Agent loop                                                  │
│    prompt assembly → model call → parse tool calls →         │
│    permission check → run tool → cap result → repeat         │
├───────────────┬───────────────────────┬──────────────────────┤
│ Context engine│ Tool registry         │ Sub-agent runner     │
│  token ledger │  search · fs · image  │  fresh context,      │
│  result store │  data · chart         │  scoped tools,       │
│  compaction   │                       │  capped summary      │
├───────────────┴──────────┬────────────┴──────────────────────┤
│  LM Studio client        │  Execution engines                │
│   models · chat · tokens │   DuckDB · V8 isolate · browser   │
└──────────────────────────┴───────────────────────────────────┘
        │ localhost only                    │ no network
        ▼                                   ▼
   LM Studio server                  local files / output dir
```

### 6.1 LM Studio integration

The harness owns the agent loop. Context control requires full authority over which messages are sent each round, so the loop is not delegated to a library.

| Need | Interface |
|---|---|
| Chat with custom tools and images | OpenAI-compatible `POST /v1/chat/completions` (stateless, streaming) |
| List models and capabilities | Native `GET /api/v1/models` |
| Load / unload with a context length | Native `POST /api/v1/models/load` and `/unload` |
| Token counting | `@lmstudio/sdk` (`model.countTokens`, `model.applyPromptTemplate`), with `usage` from chat responses as the source of truth after each call |

Notes from the current LM Studio API:

- The native `/api/v1/chat` endpoint is stateful and does not accept custom tools, so it is not suitable for this harness.
- `GET /api/v1/models` returns `capabilities.vision`, `capabilities.trained_for_tool_use`, `capabilities.reasoning`, `max_context_length`, and `loaded_instances[].config.context_length`. These drive MOD-3, MOD-6, and MOD-7.
- Authentication (LM Studio 0.4.0+) uses `Authorization: Bearer <token>`.

### 6.2 Tool contract

Each tool declares: name, a description of at most two sentences, a flat parameter schema, a permission class (`read`, `write`, `execute`), a result token cap, and the tool groups it belongs to. Tool errors are returned to the model as short, actionable text, not stack traces.

### 6.3 Execution engines

Three engines run model-written input. Each is isolated differently.

| Engine | Runs | Isolation |
|---|---|---|
| DuckDB (host process) | SQL from `query_sql` | `SELECT` only; file access limited to inspected inputs; no extension install |
| V8 isolate (`isolated-vm`) | JavaScript from `run_js` and `make_chart` | No file, network, process, or module APIs exist inside the isolate; memory and time limits |
| Headless Chromium | Vendored Vega-Lite plus a validated JSON spec | Offline; all requests blocked; no model-written code |

The V8 isolate was chosen over an OS-level sandbox because Apple's `sandbox-exec` is deprecated and its replacement, App Sandbox, is designed for signed apps rather than command-line tools.

### 6.4 Technology choices

| Area | Choice | Notes |
|---|---|---|
| Runtime | Node.js 22 LTS+, TypeScript, ESM | Started with `--no-node-snapshot` (D35) |
| Lint and format | Biome | One tool for both |
| Schema validation | zod | Also used to generate tool schemas |
| Terminal UI | Ink | Loaded for the REPL only, to protect startup time |
| Tests | vitest | |
| Name / metadata search | `mdfind` (Spotlight) | Directory walk as fallback |
| Content search | ripgrep, bundled | Pinned binary in `vendor/` |
| Trash | `trash` npm package | |
| Images | `sharp` | Resize and convert |
| Query engine | DuckDB 1.4.5, embedded, through `@duckdb/node-api` 1.4.5-r.1 | Reads CSV/TSV natively; Excel reader vendored (D37) |
| Legacy `.xls` | SheetJS 0.20.3, from the SheetJS CDN | Converted to a row set, then read by DuckDB (D36) |
| JS sandbox | `isolated-vm` 6.2.0 | Native addon; 7.x needs Node 24 (D37) |
| Word documents | `mammoth` or direct OOXML parsing | Tables are extracted and loaded into DuckDB |
| Chart library | Vega-Lite, vendored | Spec validated before render |
| Headless browser | Playwright with Chromium | Installed up front in `vendor/`; started only for rendering, closed 60 s after the last render |
| Platform | macOS only | Spotlight and Trash are used directly |

## 7. Context strategy

### 7.1 Budget

The default loaded context for the target model is 16,384 tokens. Budgets are fractions of whatever length the loaded model reports, so they adapt when the model or setting changes.

| Slice | Share | Tokens at 16k |
|---|---|---|
| System prompt and tool definitions | ≤ 10% | 1,500 |
| Conversation history, including summaries | 45% | 7,200 |
| Current tool results | 20% | 3,200 |
| Reserved for the model's response | 25% | 4,100 |

### 7.2 Techniques, in order of use

1. **Bounded tool results.** Every tool has a cap (default 800 tokens). Over-cap output goes to the result store; the model gets a preview and a handle.
2. **Compact formats.** Paths relative to a stated root, no repeated prefixes, tables instead of JSON where it is shorter.
3. **Scoped tools.** A small core set is always present. Data and chart tools, and the Vega-Lite reference, are added only once a data file is involved.
4. **Isolated sub-calls.** Image analysis and data profiling summaries run outside the main conversation.
5. **Stale result eviction.** Tool results older than a few turns are replaced by a one-line stub with their handle.
6. **Summarizing compaction.** At 70% usage, older turns are summarized into a structured note: goal, facts found, files touched, open steps.
7. **Sub-agent delegation.** Broad tasks ("search three folders and compare") are split into sub-agents that each return a capped summary.
8. **Reasoning control.** Reasoning output is stripped from history, and can be turned off for simple tool-routing turns.

### 7.3 Delegation model

Sub-agents use the same loaded model, run one at a time, and start from a fresh context containing only a task brief. They get a restricted tool set and a turn limit, and return a summary capped at a fixed size (default 300 tokens). Sub-agents cannot spawn sub-agents.

Loading a second model for delegation is out of scope for v1: on an 18 GB machine, a 12B model leaves no room for one.

## 8. Privacy and security

| ID | Requirement |
|---|---|
| SEC-1 | The harness makes network connections only to the configured LM Studio host, which must be a loopback address unless the user explicitly overrides it. |
| SEC-2 | No telemetry, analytics, crash reporting, or update checks. |
| SEC-3 | All third-party assets (Vega-Lite, fonts, the browser binary, the DuckDB Excel reader) are installed up front and loaded from disk at run time. |
| SEC-4 | The headless browser, the V8 isolate, and DuckDB have no network access, and this is verified by an automated test. |
| SEC-5 | Sessions are saved by default. Transcripts, the result store, and the audit log are stored under `~/.vix/` with user-only file permissions. |
| SEC-6 | Data profiles include real sample values, so saved transcripts can contain sensitive cell values. `vix wipe` deletes everything; `--ephemeral` avoids saving in the first place. |
| SEC-7 | Content read from files is treated as data. Instructions found inside files do not change permissions or bypass approval. |

## 9. Non-functional requirements

| Area | Target |
|---|---|
| Startup | REPL is interactive in under 500 ms when the model is already loaded |
| Whole-disk name search | Under 1 s through Spotlight |
| Content search | Under 3 s on a 10 GB folder of text |
| Spreadsheet profile | Under 10 s for a 100 MB `.xlsx`; memory use stays flat as file size grows |
| Aggregation query | Under 5 s for a group-by over 1,000,000 rows |
| Chart to PDF | Under 5 s after the data is aggregated |
| Fixed context overhead | ≤ 1,500 tokens |
| Reference hardware | Apple M3 Pro, 18 GB RAM |
| Platform | macOS only |

## 10. Success metrics

A golden task suite of roughly 40 scripted tasks, covering each scenario in section 3, is run against the target model on every release.

| Metric | Target |
|---|---|
| Golden task pass rate on Gemma 4 12B QAT | ≥ 80% |
| Tool calls that are valid on the first attempt | ≥ 95% |
| Chart requests that render within 3 attempts | ≥ 90% |
| Median tokens sent per completed task | Tracked, reduced release over release |
| Sessions that hit a context overflow error | 0 |
| Outbound network connections outside LM Studio | 0 |

## 11. Milestones

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0 Skeleton** | CLI, LM Studio client, auth, streaming, `/model`, token ledger | Chat with any LM Studio model; switch models mid-session |
| **M1 Files** | Search, read, write, edit, move, copy, trash; permissions | Scenarios S1–S5 pass |
| **M2 Context engine** | Result store, caps, eviction, compaction, sub-agents, `/context` | A 50-turn session stays within the window |
| **M3 Vision** | `view_image` with isolation and downscaling | Scenario S6 passes |
| **M4 Data and charts** | `inspect_data`, `query_sql`, `run_js`, `make_chart`, theme file, PDF export | Scenarios S7–S9 pass on a 1M-row file |
| **M5 Hardening** | Golden suite, session resume, undo, audit log, `vix wipe` | Metrics in section 10 are met |

An early spike in M0 confirms that `isolated-vm` and DuckDB build and run on Node 22 on Apple silicon, since M4 depends on both. Done 2026-11-17 (`npm run spike`); findings are D35 to D38.

Milestones give the order in which scenarios must pass. The work itself is split into parts that can be built in parallel, each with its own spec in [specs/](specs/README.md).

## 12. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Small model produces malformed or wrong tool calls | Tasks fail or loop | Flat schemas, lenient argument parsing, corrective error messages, retry limit, golden suite |
| Model-written chart code is the only chart path, and a 12B model will often get it wrong | Chart requests fail or need several attempts | Vega-Lite spec validation with precise errors; in-context reference with examples; retry limit; vision self-check; chart success tracked as its own metric |
| Model-written SQL reaches files or the network through DuckDB functions | Data exposure | `SELECT` only; external access restricted to inspected files; extensions locked (DATA-7); automated test |
| `isolated-vm` is a native addon tied to specific Node and V8 versions | Install or upgrade breakage | M0 spike; pin Node and addon versions; isolate usage behind one module so it can be replaced |
| 12B model plus Chromium on 18 GB RAM | Memory pressure, swapping | Start the browser only when rendering and close it 60 s after the last render; 16k default context |
| Compaction loses a detail the task needs | Wrong answers late in long sessions | Structured summaries; handles to stored results survive compaction |
| Spotlight index is incomplete or disabled | Search misses files | Detect index state, fall back to a walk, tell the user |
| Sensitive cell values are saved in transcripts | Exposure if the disk or backups are accessed | User-only permissions, `vix wipe`, `--ephemeral` (SEC-5, SEC-6) |
| LM Studio API changes | Breakage | Single client module; pin and test against a minimum LM Studio version |

## 13. Decisions and open questions

### 13.1 Decisions (2026-11-17)

| # | Topic | Decision | Reason |
|---|---|---|---|
| D1 | JS sandbox | V8 isolate through `isolated-vm` | No dependence on the deprecated `sandbox-exec`; no file or network APIs exist inside the isolate |
| D2 | Chart input | Model-written code only; no declarative chart tool | One path to build; full flexibility |
| D3 | Chart library | Vega-Lite, vendored | Spec is validated before render, so errors are precise and fixable |
| D4 | Query engine | DuckDB in v1, as `query_sql` | The isolate cannot read files; SQL on the host handles large files and suits small models |
| D5 | Default context | 16,384 tokens for the target model | Fits the budget in section 7 and leaves memory for Chromium |
| D6 | Platforms | macOS only | Spotlight and Trash used directly; no abstraction layer |
| D7 | File operations | Add `copy`; no bulk rename, no zip/unzip | Keeps the tool list small |
| D8 | Data sources | Spreadsheets, CSV/TSV, and `.docx` only | Keeps M4 focused |
| D9 | Chart styling | User-editable `theme.json`; the model does not style | Consistent output without spending tokens |
| D10 | Shell tool | None | Keeps the local-only guarantee simple to verify |
| D11 | Sample data | Real sample values are shown to the model | Best column and chart selection; values stay local |
| D12 | Transcripts | Saved by default, with `vix wipe` and `--ephemeral` | Resume works; the user controls retention |
| D13 | Name | `vix` | After Vixen |
| D14 | Approvals in one-shot mode | Anything that would prompt is denied; a `--permission-mode` flag pre-authorizes a mode for the run | There is no terminal to ask on; scripts still need a way to allow changes |
| D15 | Activating the data tools | The harness adds the data group when a data file path appears in the prompt, an attachment, or a tool result. One prompt-cache miss per activation is accepted | `inspect_data` is itself a data tool, so the model cannot switch the group on; native tool calling is kept |
| D16 | Stored row sets | JSON Lines | Readable by DuckDB, the isolate, and `read_result` without an engine |
| D17 | Profiling | Tabular files through DuckDB; `.docx` through a direct OOXML parser, with its tables stored as row sets | No second reader or type inference to maintain |
| D18 | Sub-agents | Read-only tools; 8-turn limit, configurable | No approval prompt can come from inside a sub-agent; bounds a wandering one |
| D19 | Execute-class approvals | `query_sql` and `run_js` ask once per data file per session, and that grant covers `make_chart`. The chart's output file follows the write rules (resolves O2) | A chart task should not mean five prompts |
| D20 | `delete` in auto-edit mode | Still asks | Keeps PERM-5 as written |
| D21 | Terminal UI | Ink | Status line and pickers without hand-drawn terminal code |
| D22 | Model loaded with another context length | Reload with the configured length | Predictable budgets |
| D23 | Minimum LM Studio version | 0.4.0, warned about at startup, not enforced (resolves O4) | First version with the v1 API and tokens |
| D24 | `find_files` default scope | The home folder; the whole machine only when asked | That is where the user's documents are |
| D25 | Document content not indexed | Fall back to local text extraction | Search stays complete where Spotlight is not |
| D26 | Trash | `trash` npm package | Fast, and no automation permission prompt |
| D27 | Undo | Single level, from a full snapshot with no size limit | Matches FS-9; only the newest snapshot needs keeping |
| D28 | Chart output location | Beside the data file, named from the chart title, never overwriting | The chart lives with its source |
| D29 | Chart self-check | One automatic retry on a failed check | Fewer bad charts reach the user |
| D30 | Browser lifetime | Kept for 60 s after the last render, then closed | Follow-up charts skip the cold start |
| D31 | Vendored assets | In the project's `vendor/`: Chromium, Vega-Lite, the DuckDB Excel reader, and a pinned ripgrep. The default theme uses a macOS system font | `vix wipe` cannot touch them; nothing third-party runs at install |
| D32 | Sessions | `/clear` starts a new session; `--resume` opens the most recent; sessions are kept until wiped; `vix wipe` confirms unless `--yes` | Extends D12 |
| D33 | Evals | 3 runs per task, run by hand before a release; the network test uses a recording proxy and a socket monitor together | A local model cannot run in hosted CI; neither observer is complete alone |
| D34 | Test runner | vitest | Native TypeScript and ESM |
| D35 | Node start-up flag | `vix` runs Node with `--no-node-snapshot`, set in the bin's shebang so Node is never re-launched | `isolated-vm` documents the flag as required on Node 20+. The spike ran fine without it, but it cannot rule out an intermittent crash, and the flag costs about 18 ms at startup |
| D36 | Legacy `.xls` reader | SheetJS 0.20.3, installed from the SheetJS CDN (the npm registry copy is stale). The sheet is converted to a stored row set that DuckDB reads (resolves O1) | DuckDB's Excel reader handles `.xlsx` only. SheetJS is not streaming, but the `.xls` format caps a sheet at 65,536 rows, so memory is bounded; the spike read a full-size sheet in under 200 ms |
| D37 | Native addon versions | `isolated-vm` 6.2.0 and `@duckdb/node-api` 1.4.5-r.1 (DuckDB 1.4.5, the LTS line), pinned exactly | `isolated-vm` 7.x needs Node 24+. Both versions passed the spike on Node 22.22 on Apple silicon |
| D38 | Files added to a locked DuckDB session | The in-memory DuckDB instance is rebuilt, with the new file added to `allowed_paths`, whenever a file is registered | A locked configuration cannot be extended. A rebuild takes 10 to 20 ms and the instance holds no state worth keeping, since inputs are views over files |
| D39 | HEIC and BMP images | Converted by the harness with the macOS built-in `/usr/bin/sips`, run with an argument list and no shell, writing into the session scratch folder. Other formats try `sharp` first and fall back to `sips` | `sharp` 0.35.5 has no HEVC decoder and cannot read BMP. This is harness code, not a model-facing shell, so D10 and PERM-6 still hold |
| D40 | AVIF images | Accepted by `view_image` in addition to the IMG-1/IMG-4 formats | `sharp` decodes it at no extra cost |

Decisions internal to one part (limits, cache rules, eviction age) are recorded in that part's spec under [specs/](specs/README.md).

### 13.2 Still open

| # | Question | Leaning |
|---|---|---|
| O3 | Is the `vix` package name free on npm, if the tool is ever published? | Not checked; irrelevant while it is installed locally |

O1, O2, and O4 were resolved by D36, D19, and D23. Questions local to one part are listed in [specs/README.md](specs/README.md).

## Appendix A: Environment facts (2026-11-17)

- **Target model:** `google/gemma-4-12b-qat`. 12B parameters, GGUF, minimum 7 GB system memory. Supports image input, native tool use, and reasoning (on by default). Recommended sampling: temperature 1, top-k 64, top-p 0.95. Maximum context length is not published on the model page and is read from the API at run time.
- **Development machine:** Apple M3 Pro, 18 GB RAM, macOS 26.6, Node.js 22.22.
- **LM Studio:** running on `localhost:1234` with API token authentication enabled.
- **Models currently downloaded:** `google/gemma-4-e4b` (loaded), `orpheus-3b-0.1-ft`, and the `nomic-embed-text-v1.5` embedding model. The target 12B model is not downloaded yet.

## Appendix B: Tool inventory (v1)

| Group | Tool | Permission | Purpose |
|---|---|---|---|
| core | `find_files` | read | Name and metadata search |
| core | `search_content` | read | Search inside files |
| core | `list_dir` | read | Directory listing |
| core | `read_file` | read | Read text by line range |
| core | `read_result` | read | Page through a stored result |
| core | `write_file` | write | Create or overwrite a text file |
| core | `edit_file` | write | String replacement edit |
| core | `make_dir` | write | Create a folder |
| core | `move` | write | Move or rename |
| core | `copy` | write | Duplicate a file or folder |
| core | `delete` | write | Move to Trash |
| core | `delegate` | read | Run a sub-agent |
| vision | `view_image` | read | Ask about an image |
| data | `inspect_data` | read | Profile a spreadsheet or document |
| data | `query_sql` | execute | Read-only SQL over a data file |
| data | `run_js` | execute | JavaScript in a V8 isolate |
| data | `make_chart` | execute | Chart code to PDF, PNG, or SVG |
