# Data inspection

| | |
|---|---|
| **Wave** | 1 |
| **Milestone** | M4 |
| **Owns** | `src/tools/data/inspect/`, `src/data/` (the data source registry) |

## Purpose

The first step of the data path, and the only view of a data file the model ever gets: a compact profile instead of the contents (PRD principle 4). Covers scenario S7 and prepares S8 and S9. Inspecting a file also registers it, which is what later allows SQL to read it.

## Requirements

- DATA-1: `inspect_data` and format detection by content signature.
- DATA-2: the spreadsheet profile.
- DATA-3: the `.docx` profile.
- DATA-4: streaming, at least 1,000,000 rows or 500 MB.
- DATA-5: masking of sample values.
- Decisions D8 and D11, and open question O1, in the PRD.

## Provides

- One `ToolDefinition`, `inspect_data`, in the `data` group with `read` permission.
- The `DataSourceRegistry` implementation: for each inspected file, a handle, the real path, and the SQL table name for each sheet or table.

## Consumes

| Contract | From | Fake until it exists |
|---|---|---|
| `PathPolicy` | permissions | Fake with a fixed deny list |
| `ResultStore` | context | In-memory fake |
| The DuckDB engine, for profiling tabular files | sql | None. Format detection, the `.docx` parser, the registry, and profile formatting can start at once; tabular profiling starts when the engine module exists |

## Design notes

- **Detect, then trust nothing else.** Identify the format from the file's first bytes and, for the zip-based formats, from what is inside the archive. A `.csv` that is really an `.xlsx` is handled as an `.xlsx`, and the profile says so.
- **The profile is the model's whole picture of the data**, so its format matters. One compact table per sheet, one row per column, with the fields in DATA-2. It must fit the tool's token cap for ordinary files.
- **Wide files.** A sheet with hundreds of columns will not fit. The full profile goes to the result store, and the model gets the first columns plus a handle it can page or search.
- **Table names are part of the contract.** The profile prints the exact name the model must use in SQL for each sheet or table. [sql](sql.md) resolves those names through the registry. Names are short and stable within a session.
- **Header detection.** Real spreadsheets have title rows, blank rows, and merged cells above the header. Detect the header row, report which row it is, and let the caller override it.
- **Type inference** covers at least number, date, boolean, and text, and reports mixed columns as mixed instead of guessing.
- **Memory stays flat.** No step may hold a whole sheet in memory. Distinct counts on a million-row column may need to be approximate; if so, the profile marks them as approximate.
- **Tabular profiling goes through DuckDB.** The engine already streams, infers types, and computes statistics, so this part does not write a second reader for `.xlsx`, `.csv`, or `.tsv`. This part still owns header detection and the profile's format.
- **`.docx` tables become data.** The document profile lists the heading outline and each table's position, size, and header. Each table is also written to the session's result store as a JSON Lines row set and registered under its own table name, so "the second table in the board report" (S9) is queryable.
- **Profiles are cached** per file for the session, keyed by path, size, and modification time.
- **Sample values are real** (D11), which is why profiles are sensitive and why [storage](storage.md) exists.
- **Registration is the allow-list.** DATA-7 limits DuckDB to inspected input files. That list is this registry.

## Not in this part

- Running queries (sql) or transforms (sandbox).
- PDF, PowerPoint, and scanned images, which are PRD non-goals as data sources.
- Writing back to office files.

## Done when

- Fixture files for `.xlsx`, `.xls`, `.csv`, `.tsv`, and `.docx` each produce the expected profile.
- A file with a misleading extension is identified correctly.
- A sheet with a title block above the header is profiled with the right header row.
- A generated 1,000,000-row file is profiled with peak memory measured and recorded, and that figure does not grow when the file is made larger.
- A 100 MB `.xlsx` is profiled in the time given in PRD section 9, measured on the reference machine.
- After inspection, the registry returns the path and table names for the handle.
- A second inspection of an unchanged file returns without re-reading it; after the file is modified, it is profiled again.

## Decisions

Settled 2026-11-17. A D-number means the decision is also recorded in PRD section 13.1.

| Topic | Decision |
|---|---|
| Who reads the file | Tabular files are profiled through the DuckDB engine in [sql](sql.md). `.docx` files get a direct OOXML parser (D17). |
| Where `.docx` tables go | The session's result store, as JSON Lines row sets (D17). |
| Profile caching | A profile is reused while the file's size and modification time are unchanged, and recomputed when either differs. |

## Open questions

- O1 from the PRD: the reader for legacy `.xls`. Answered by the foundation spike.
