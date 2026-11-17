# Output formats

| | |
|---|---|
| **Wave** | 4 |
| **Milestone** | M4 |
| **Owns** | `src/output/`, `src/tools/data/export-table.ts`, `src/contracts/output.ts` |

## Purpose

Let an office user get their result as a file they can open in Word or Excel, and let the user, not the model, choose the format. This part owns the list of formats, the one rule for choosing among them, the Word and Excel writers, and the `export_table` tool. [chart](chart.md) uses it to save charts; [pdf](pdf.md) draws the pictures and the PDF table.

Everything here creates a new file. Editing an existing `.docx` or `.xlsx` stays a non-goal (PRD section 2).

## Requirements

- DATA-13, its share: the list of formats.
- DATA-21: `export_table`.
- DATA-22: how the format is chosen.
- DATA-23, its share: what a Word or Excel file holds. [chart](chart.md) decides what goes in for a chart.
- CLI-3 and CLI-12, their share: `/format` and what `--format` means. [cli](cli.md) parses the flag and lends the picker.
- SEC-1 to SEC-3: no writer makes a network call or runs an install script.
- Decisions D85 to D89.

## Provides

- `outputFormats` in `src/contracts/output.ts`: `xlsx`, `docx`, `pdf`, `png`, `svg`, `csv`. The one list. The tools' `format` parameter, `--format`, `/format`, `output.defaultFormat`, the picker, and the extension check on an `output_path` all read it.
- `settledOutputFormat`, `askOutputFormat`, `resolveOutputFormat` (`src/output/resolve-format.ts`): the order below, used by `make_chart` and `export_table`.
- `buildDocx` (`docx-writer.ts`) and `buildWorkbook` (`xlsx-writer.ts`), and what they are used for: `chart-files.ts` and `table-files.ts`.
- Output naming (`naming.ts`): D28 for every output file.
- The `export_table` tool and the `/format` slash command.

### How the format is chosen (D85)

One order, for every tool that writes a chart or a table:

| Step | Source | Notes |
|---|---|---|
| 1 | The request | The tool's `format` argument, or the extension of its `output_path`. Counts only when the user's latest message names that format (D86). |
| 2 | The session | `--format <name>` at start, `/format <name>` later, or a pick the user kept. Held in `SessionState.outputFormat`. |
| 3 | The config | `output.defaultFormat`, unset by default. |
| 4 | The user | In the REPL the picker asks "Save the chart as which format?", then "This chart only" or "Every file in this session". Closing either question saves nothing. |

Where nobody can be asked (one-shot mode, D14), step 4 is a tool error that names the formats and `--format`, and tells the model not to call the tool again.

A session or config format that cannot hold the output (`png` for a table, `csv` for a chart) is skipped, not an error: it was set with other files in mind. A format the request names that cannot hold the output is an error that points at the other tool.

`format` is an optional tool parameter on purpose. A required one would make a small model pick a format on every call, and the user would never be asked.

### What reaches a tool

`ToolContext.outputFormat` (add-only, optional):

- `sessionFormat`: step 2.
- `namedByUser`: the formats the user's latest message names, for D86. Undefined means unknown, and the arguments are trusted; that is the case in unit tests that build a bare context.
- `ask`: step 4. Absent in one-shot mode and for sub-agents. A pick the user keeps is stored on the session by the harness (`src/app/output-format.ts`), so it behaves exactly like `/format`.

## Consumes

| Contract | From | Notes |
|---|---|---|
| `ResultStore` | context | Row sets by handle; `export_table` streams them for CSV |
| `PathPolicy`, `ChangePreview` | permissions | `export_table` is a write tool |
| `renderTable`, `renderChartImage` | pdf | The PDF table and the picture in a Word document |
| The picker (`SlashCommandContext.choose`, `HarnessOptions.choose`) | cli | Lent to the harness; the question's wording is here |
| Theme loader, row-source tracing | chart | Page size, font, footer; which data file a row set came from |

## Design notes

- **Guessed formats (D86).** The arguments are written by the model. `formatsNamedIn` looks in the user's latest message for a small fixed vocabulary: `pdf`; `docx`, `doc`, `word`; `xlsx`, `excel`, `spreadsheet`, `workbook`; `png`, `image`, `picture`; `svg`; `csv`. A format in the arguments that the message does not name is treated as absent, so the session, the config, or the question decides. The check can only add a question; it never picks a format. It errs towards finding a format: a data file's own name counts ("chart payroll.xlsx" names xlsx), which at worst trusts the model as before. Known limits are under Decisions.
- **The question comes last.** `make_chart` asks only after the chart code ran, the specs validated, and the self-check passed, so a chart that fails never costs the user a question. `export_table` asks after the approval prompt and before reading the rows.
- **The approval preview needs no question.** `settledOutputFormat` covers steps 1 to 3. When they settle nothing, the preview says "you choose the format next" and names the folder, which is what the permission decision depends on.
- **Typed cells.** Row sets are JSON (D16), so dates arrive as ISO text. A column is written as Excel dates only when every value in it is an ISO date or date-time; a stray date-like string in a text column stays text. Dates use Excel's built-in formats 14 and 22, which Excel shows in the reader's locale and DuckDB's Excel reader recognises (ROADMAP task 24). Numbers and booleans are typed per cell. Nested values are written as JSON text. Conversion is in UTC (`src/shared/excel-dates.ts`, shared with the `.xls` reader).
- **Word documents** are written as raw WordprocessingML in a ZIP: headings, paragraphs, inline PNG pictures, and tables whose header row repeats on each page. Page size and orientation, the font, and the footer come from the theme. Characters XML forbids are dropped from cell text, so one bad cell cannot make Word refuse the file. The theme's logo is not placed.
- **Excel workbooks** hold no picture: SheetJS cannot embed one. A chart workbook has a `Summary` sheet and one sheet per chart with that chart's rows; the tool result says so, so the model can tell the user.
- **Never overwrite (D28).** Every writer opens its file exclusively. `export_table` names the file from its title, or from the data file ("sales.csv" gives "sales"), and appends a number when the name is taken; an export beside `sales.csv` as CSV is `sales-2.csv`.
- **Lazy loading.** SheetJS is imported at the point of use (`await import("xlsx")`). The Word writer needs only Node's `zlib`.

### `export_table`

| | |
|---|---|
| Group | `data` |
| Permission | `write` (D89) |
| Parameters | `handle`, `title?`, `format?`, `output_path?` |
| Formats | `xlsx`, `docx`, `pdf`, `csv`; `png` and `svg` are refused with a pointer to `make_chart` |
| Default location | Beside the first data file the rows came from, else the working folder |
| Row caps | `docx`, `pdf`: `output.maxDocumentTableRows` (2,000). `xlsx`: `output.maxSheetRows` (1,048,575, the most a sheet holds under a header row; the config cannot set it higher). `csv`: none, rows are streamed |
| Definition cost | About 148 estimated tokens (4 characters per token). Real count not measured: it needs LM Studio |

Over a cap, the error tells the model to aggregate with `query_sql` (GROUP BY, or ORDER BY with LIMIT) or to use a format that holds more.

## Not in this part

- Drawing a chart or printing a PDF table (pdf).
- What a chart is and how its code is checked (chart).
- Editing an existing office file. A PRD non-goal.
- A chart picture inside an `.xlsx`, and native Excel charts.

## Done when

- An exported `.xlsx` read back through `inspect_data` and DuckDB has the same rows and the same column types.
- An exported `.docx` is read back by the project's own OOXML reader and by macOS `textutil`.
- A chart `.docx` holds a valid PNG part for each chart, each chart's title as a heading, and each summary as text.
- Every step of the format order is covered by a test, with the one-shot error, `/format`, `--format`, the row caps, and never-overwrite naming.
- The REPL question is driven through the real controller and harness: a pick for one file, a pick kept for the session, and Esc.

## Decisions

Settled 2026-11-17. A D-number means the decision is also recorded in PRD section 13.1.

| Topic | Decision |
|---|---|
| Who chooses the format | The user, in the order above (D85). `format` stays optional. |
| A format the user did not name | Ignored, so it cannot skip the question (D86). Checked against the latest user message only: a follow-up such as "now by month" after "as a PDF" asks once, and "every file in this session" ends the asking. A request in another language names no format the check knows, so the REPL asks and one-shot mode needs `--format`. |
| What the files hold | D87. A chart `.docx`: per chart a heading, the chart as a PNG drawn at three device pixels per CSS pixel (2,160 x 1,320 for the default size) without its own title, and the summary as text; several charts print portrait, a page each, as in the PDF. A chart `.xlsx`: a `Summary` sheet and a typed data sheet per chart. |
| Writers | D88. SheetJS 0.20.3 for `.xlsx`. A direct OOXML writer for `.docx`, not the `docx` npm package: the document needs four kinds of block, the project already reads this XML itself (D17) and already had a ZIP writer, and a new dependency tree would have to be audited for install scripts and network use (SEC-1 to SEC-3). |
| `export_table` permission | D89. `write`, not `execute`: it runs no model-written code. In `ask` mode it asks; in `auto-edit` it runs inside the allowed folders; outside them it always asks. One-shot mode needs `--permission-mode auto-edit`; `--allow-data` covers only the query that produced the rows. |
| CSV | Included as a table format: it is a few lines over the same rows. It starts with a UTF-8 byte order mark so Excel reads accents correctly, and uses CRLF line ends. |
| One-shot exit status | A missing format is a tool error, not a denial, so the exit status follows the turn (D55). The tool line on stderr shows the failure. |
| ZIP writer | One, in `src/shared/zip-writer.ts`, moved from the eval fixtures; the fixture generators and inspect's test fixtures use it too. Stored entries give the same bytes as before, so the committed samples are unchanged. |
| Fixed overhead | `export_table` adds about 148 estimated tokens and `make_chart`'s longer format list about 11, both in the `data` group only. The "all" ceiling in `src/app/fixed-overhead.test.ts` went from 1,835 to 1,927 estimated tokens. |
| Largest workbook | Measured on the development machine with SheetJS: 1,000,000 rows by 8 columns wrote in 12 s with 640 MB resident memory. A sheet too large for SheetJS to build is reported as a tool error that suggests CSV. |
| Checked by eye | Sample files rendered with macOS Quick Look (`qlmanage -t`): a chart `.docx`, a table `.docx`, a chart `.xlsx`, a table `.xlsx`, and a PDF table. Not opened in Word or Excel. |

## Open questions

None.
