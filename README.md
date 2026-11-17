# vix

`vix` is a command-line assistant that runs entirely on your Mac. It talks to a model served by [LM Studio](https://lmstudio.ai) and can:

- find files by name, date, size, or content;
- read, create, edit, move, copy, and trash text files and folders, with your approval;
- describe images and transcribe text from screenshots and scans;
- profile spreadsheets, CSV/TSV files, and Word documents, query them with SQL, and turn the results into charts saved as PDF, PNG, or SVG.

Nothing leaves your machine. `vix` connects only to LM Studio on `localhost`, and its tools make no network requests. Requirements and design decisions are in [PRD.md](PRD.md).

## Requirements

- macOS on Apple silicon. Intel Macs are not supported yet, because the vendored chart browser is pinned for arm64 only.
- Node.js 22.12 or later.
- LM Studio 0.4.0 or later, with its local server running and API token authentication enabled.
- A downloaded model. The default is `google/gemma-4-12b-qat`, which needs about 9.4 GB of free memory to load at the default 16,384-token context. If another model is loaded, LM Studio may refuse to load it until you unload the other one.

## Setup

### 1. Prepare LM Studio

1. Download `google/gemma-4-12b-qat` (or another model with tool use) in LM Studio.
2. Start the local server (Developer tab). The default address is `http://localhost:1234`.
3. In **Developer > Server Settings**, create an API token and copy it.

### 2. Install vix

```sh
git clone <this repository> vix
cd vix
npm ci            # dependencies
npm run vendor    # pinned ripgrep, DuckDB Excel reader, Vega-Lite, and Chromium (about 210 MB)
npm run build     # compiles to dist/
npm link          # optional: puts `vix` on your PATH
```

`npm run vendor` is the only step that downloads anything. Every file is pinned to a version and checked against a SHA-256 checksum, and nothing is fetched while `vix` runs. Without `npm link`, run `./bin/vix.js` instead of `vix`.

### 3. Configure

```sh
vix config
```

The setup asks six questions. Press Enter to keep the value shown in brackets.

1. LM Studio address.
2. API token. It is typed hidden and checked against LM Studio straight away; a rejected token is never saved.
3. Default model, picked from the models LM Studio reports.
4. Context length (default 16,384).
5. Permission mode: `ask`, `auto-edit`, or `read-only` (see [Permissions](#permissions)).
6. Allowed folders, where file changes are permitted. Leave it empty to mean "the folder I start vix in".

It saves `~/.vix/config.json`, readable only by you. If you start `vix` without a token, it offers to run this setup for you. The `LM_API_TOKEN` environment variable, if set, overrides the saved token.

## Using vix

### Interactive

```sh
cd ~/Documents/some-project
vix
```

Type a request and press Enter. Each tool call is shown as one line (tool, main argument, result size, time). The status line shows the model, how much of the context is used, and the permission mode.

- `Ctrl+C` stops the current answer or tool. A second `Ctrl+C` exits.
- Drag a file into the terminal, or type its path, to attach it to your request.

Example requests:

- "Find the lease PDF I downloaded last spring."
- "Which notes mention the Q3 vendor renewal?"
- "Create a 2026-taxes folder with a checklist.md inside."
- "In config.yaml, change the port to 8080."
- "What does receipt.jpg say?"
- "What's in samples/payroll_2025.xlsx?"
- "Chart monthly headcount by department as a stacked bar from samples/payroll_2025.xlsx."

### Slash commands

| Command | What it does |
|---|---|
| `/model [key]` | List models, or switch to another one |
| `/context` | Show how the context window is used |
| `/compact` | Drop old tool results and summarize older turns now |
| `/think [on\|off]` | Turn the model's reasoning on or off |
| `/permissions` | Show or change the permission mode and this session's grants |
| `/undo` | Undo the last file change made in this session |
| `/config` | Run the setup again |
| `/clear` | Start a new session with an empty context (the old one stays saved) |
| `/help` | List the slash commands |
| `/exit` | Quit |

### One-shot

```sh
vix -p "Which file in this folder mentions the vendor renewal?"
cat notes.txt | vix -p "Summarize this"
vix -p "Total units per region in samples/sales_2025.csv" --allow-data
vix -p "List the PDFs in ~/Downloads" --json
```

One-shot mode prints the answer to stdout, and tool lines and errors to stderr. It cannot ask for approval, so anything that would need approval is refused unless a flag allows it:

- `--permission-mode auto-edit` allows file changes inside the allowed folders.
- `--allow-data` allows SQL, scripts, and charts on data files inside the allowed folders.

`delete` always needs interactive approval.

Exit status: `0` done, `1` failed or something was refused, `2` usage error, `130` cancelled.

### Options

| Option | Meaning |
|---|---|
| `-p, --print <prompt>` | One-shot mode |
| `--json` | One-shot output as JSON, for scripts |
| `--allow-data` | One-shot: allow SQL, scripts, and charts on data files inside the allowed folders |
| `--model <key>` | Use this model instead of the configured default |
| `--permission-mode <mode>` | `ask`, `auto-edit`, or `read-only`, for this run |
| `--base-url <url>` | LM Studio address for this run |
| `--ephemeral` | Leave nothing on disk when the session ends |
| `--resume` | Reopen the most recent saved session |
| `vix wipe [--yes]` | Delete all saved sessions, stored results, and logs |

## Permissions

Reading never asks. Changes depend on the mode:

| Mode | File changes inside allowed folders | Changes elsewhere | `delete` | SQL, scripts, charts |
|---|---|---|---|---|
| `ask` (default) | ask | ask | ask | ask once per data file |
| `auto-edit` | allowed | ask | ask | ask once per data file |
| `read-only` | refused | refused | refused | refused |

When asked, you can approve once, approve for the rest of the session, or deny with a note that is passed back to the model.

Some places are never read or written in any mode: `~/.ssh`, keychains, browser profiles, credential files such as `id_rsa`, `.netrc`, and `.git-credentials`, system folders, and `~/.vix` itself. `delete` moves things to the macOS Trash, and `/undo` reverses the last change. Nothing is ever permanently deleted by the model.

There is no shell tool: the model cannot run commands.

## Working with data

Point `vix` at a `.csv`, `.tsv`, `.xlsx`, `.xls`, or `.docx` file. It works in steps, and the full data never enters the model's context:

1. `inspect_data` profiles the file: sheets or tables, header row, and per column the type, nulls, distinct values, range, and three sample values.
2. `query_sql` runs a read-only SQL query with DuckDB.
3. `run_js` reshapes rows in a sandboxed JavaScript isolate with no file or network access (optional).
4. `make_chart` builds a Vega-Lite chart and renders it in an offline browser. The chart is saved beside the data file as PDF (default), PNG, or SVG, together with its SQL and spec so it can be reproduced.

Chart colors, fonts, page size, logo, and footer come from `~/.vix/theme.json`. Without that file, a built-in theme is used.

### Sample data

[`samples/`](samples/README.md) holds six small, fictional files to try this on: sales orders (CSV), warehouse stock (TSV), a three-sheet payroll workbook (XLSX), a legacy budget workbook (XLS), a board report with four tables (DOCX), and an XLSX saved with a `.csv` name. The [samples README](samples/README.md) lists prompts for each.

```sh
vix -p "What were total units sold per region in samples/sales_2025.csv? Use SQL." --allow-data
```

## Files and privacy

```
~/.vix/
  config.json        settings (from vix config)
  theme.json         chart styling (optional)
  logs/audit.jsonl   one line per tool call
  sessions/<id>/     transcript, stored results, undo snapshots, scratch files
```

Everything under `~/.vix` is readable only by you. Sessions are saved so `--resume` works. Transcripts and stored results can contain real values from your files, so:

- `vix wipe` deletes all sessions, stored results, snapshots, and logs (it keeps `config.json` and `theme.json`);
- `--ephemeral` runs a session that leaves nothing on disk.

Set `VIX_HOME` to use a folder other than `~/.vix`.

## Development

| Command | What it does |
|---|---|
| `npm run lint` | Biome, then a TypeScript type check |
| `npm test` | vitest |
| `npm run build` | Compile to `dist/` |
| `npm run vendor [-- <step>]` | Install pinned third-party assets into `vendor/` |
| `npm run samples` | Regenerate `samples/` (byte-identical) |
| `npm run evals` | Golden task suite (needs LM Studio) |

Run `npm run vendor` before `npm test`, or the tests that need ripgrep, DuckDB's Excel reader, or the browser skip themselves. Tests that talk to a real LM Studio are opt-in:

```sh
VIX_LIVE_LMSTUDIO=1 LM_API_TOKEN=… npx vitest run src/lmstudio/live.test.ts
```

Project rules for contributors are in [CLAUDE.md](CLAUDE.md), the per-part design in [specs/](specs/README.md), and current status in [ROADMAP.md](ROADMAP.md).

## Status

`vix` is pre-release. It runs end to end against LM Studio with Gemma 4 12B QAT. The golden task suite has not yet been run against the model, so success rates are not measured yet. Known gaps are tracked in [ROADMAP.md](ROADMAP.md).
