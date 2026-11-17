# Foundation

| | |
|---|---|
| **Wave** | 0 (serial; blocks every other part) |
| **Milestone** | M0 |
| **Owns** | `package.json`, `tsconfig.json`, `src/contracts/`, `src/config/`, `src/testing/`, `scripts/` |

## Purpose

Give every other part something to build against. After this part lands, fifteen parts can start at once without importing each other, because the shared types and the fakes already exist.

Keep it small. This part defines shapes and conventions. It implements no features.

## Requirements

- SEC-3, the convention only: where vendored assets live and how they are installed. Each part vendors its own assets.
- PRD section 6.2 (tool contract) and section 6.4 (runtime, schema validation), as types.
- PRD section 11: the early spike confirming `isolated-vm` and DuckDB build and run on Node 22 on Apple silicon.
- Open question O1 (which reader handles legacy `.xls`), answered by the spike.

## Provides

### 1. Scaffold

- Node.js 22, TypeScript in strict mode, ESM, with a `vix` bin entry.
- `vitest` as the test runner, one linter, one formatter, wired to `npm test`, `npm run lint`, `npm run build`.
- The directory layout listed in the parts table of [README.md](README.md), with an empty module per part so imports resolve from day one.

### 2. Shared contracts (`src/contracts/`)

Types only, no logic. The sketches below show intent; the code replaces them as the source of truth.

```ts
type PermissionClass = "read" | "write" | "execute";
type ToolGroup = "core" | "vision" | "data";

interface ToolDefinition<Arguments> {
  name: string;
  description: string;          // at most two sentences
  parameters: ZodObject;        // flat: no nested objects
  permission: PermissionClass;
  resultTokenCap: number;
  groups: ToolGroup[];
  previewChange?(args: Arguments, context: ToolContext): Promise<ChangePreview>;
  run(args: Arguments, context: ToolContext): Promise<ToolOutput>;
}

// Tools return full output. The agent loop caps it, so no tool truncates on its own.
interface ToolOutput {
  text: string;
  handles?: ResultHandle[];     // results the tool already stored itself
}

type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool-start"; callId: string; tool: string; keyArgument: string }
  | { type: "tool-end"; callId: string; resultTokens: number; durationMs: number; error?: string }
  | { type: "turn-end"; reason: "done" | "cancelled" | "error" | "limit" };

interface LmClient {
  listModels(): Promise<ModelInfo[]>;
  loadModel(key: string, options: { contextLength: number }): Promise<LoadedModel>;
  unloadModel(instanceId: string): Promise<void>;
  chat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>;
  countTokens(messages: ChatMessage[]): Promise<number>;
}

interface ResultStore {
  putText(text: string, meta: ResultMeta): Promise<ResultHandle>;
  putRows(rows: AsyncIterable<Row>, meta: ResultMeta): Promise<ResultHandle>;
  readText(handle: ResultHandle, range: TextRange): Promise<string>;
  readRows(handle: ResultHandle, limit?: number): AsyncIterable<Row>;
  describe(handle: ResultHandle): Promise<ResultMeta>;   // kind, size, provenance
}
```

The remaining contracts, each a small interface or type:

| Contract | Meaning |
|---|---|
| `ToolContext` | What a running tool receives: abort signal, `ResultStore`, `PathPolicy`, `DataSourceRegistry`, `ReadTracker`, `LmClient`, `VixPaths`, config |
| `ToolError` | An error whose message is short, safe to show the model, and says what to try next |
| `ChangePreview` | A diff or a one-line summary of what a write or execute tool is about to do |
| `PermissionGate` | `check(tool, args, preview)` returning allow, or deny with feedback for the model |
| `PathPolicy` | Classifies a path: inside an allowed root, outside, or on the deny list |
| `ApprovalPrompter` | Asks the user: once, always for this session, or deny with feedback |
| `ContextEngine` | Budgets, `capResult`, `prepareMessages`, `compact`, usage snapshot |
| `DataSourceRegistry` | Inspected data files: handle, path, and the SQL table names they expose |
| `ReadTracker` | Which files were read in this session, and their state when read |
| `SessionState` | Messages, active model, permission mode, session grants |
| `VixPaths` | Every location under `~/.vix/` and inside the current session directory |
| `SlashCommand` | Name, help line, and handler, so parts register commands without editing the CLI |
| `ChartRenderRequest` | Validated spec, rows, theme, output format, output path |
| `Config` | The zod schema for `~/.vix/config.json` |

### 3. Config (`src/config/`)

Loads `~/.vix/config.json`, validates it with zod, and layers environment variables and command-line flags on top. Defaults come from the PRD (base URL, default model, context length, caps, allowed roots). Each default is defined once, here.

### 4. Fakes (`src/testing/`)

- A scripted `LmClient` that replays a list of responses, including tool calls and malformed ones.
- An in-memory `ResultStore`.
- An `ApprovalPrompter` that answers from a queue.
- A temporary `VixPaths` rooted in a scratch directory.

### 5. Vendoring convention

A `vendor/` directory and one `npm run vendor` entry point. Each part adds its own step (ripgrep, the DuckDB Excel reader, Vega-Lite, Chromium). Each step pins a version and checks a checksum. Nothing is fetched at run time.

### 6. Native-addon spike

A throwaway script that loads `isolated-vm` and DuckDB on the reference machine, runs one isolate evaluation and one query, and reads one `.xlsx` and one `.xls` file. Record the pinned versions and the findings in the PRD.

## Consumes

Nothing.

## Design notes

- Contracts change after wave 1 starts only by agreement, because a change touches several parts at once. Add fields; avoid renaming.
- `isolated-vm` has needed a Node start-up flag (`--no-node-snapshot`) on recent Node versions. The spike must confirm whether Node 22 needs it, because it changes how the `vix` bin launches Node.
- Heavy native modules (`isolated-vm`, DuckDB, `sharp`, Playwright) must be loaded lazily everywhere, or the 500 ms startup target in PRD section 9 is lost. State this as a rule in the scaffold.

## Not in this part

- Any implementation of a contract. `src/contracts/` has types; the owning part has the code.
- The tool registry (agent-loop) and `~/.vix/` file handling (storage).

## Done when

- `npm run build`, `npm run lint`, and `npm test` succeed on a clean checkout.
- A sample test in another part's directory imports a contract and a fake and passes.
- The spike prints a DuckDB query result and an isolate evaluation result on Node 22 on Apple silicon, and its findings are recorded.

## Decisions

Settled 2026-11-17. A D-number means the decision is also recorded in PRD section 13.1.

| Topic | Decision |
|---|---|
| Test runner | `vitest` (D34). |
| Vendored assets | Everything vendored lives in the project's `vendor/` directory, not under `~/.vix/` and not in a shared cache (D31). |

## Open questions

Both are answered by the spike, not by choice.

- Is `--no-node-snapshot` required, and if so, does the bin re-launch Node or use a wrapper script?
- O1 from the PRD: the `.xls` reader.
