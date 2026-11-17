# SQL engine

| | |
|---|---|
| **Wave** | 1 |
| **Milestone** | M4 |
| **Owns** | `src/engines/duckdb/`, `src/tools/data/query-sql.ts` |

## Purpose

Filter, group, and aggregate large files without loading them into the model's context or into JavaScript. The model writes a `SELECT`; embedded DuckDB runs it on the host; a capped preview returns and the full result stays behind a handle. This is the main data path (decision D4).

DuckDB runs in the harness process, not in a sandbox, so the lockdown in this part is a real security boundary.

## Requirements

- DATA-6: `query_sql`.
- DATA-7: the lockdown.
- DATA-9, its share: time, memory, and output limits; capped preview.
- SEC-3, its share: the Excel reader is vendored at install time.
- SEC-4, its share: prove DuckDB has no network access.
- The DuckDB risk row in PRD section 12.

## Provides

- The DuckDB engine module: open a locked-down connection for the session, with inspected files exposed as tables. [inspect](inspect.md) also uses it to profile tabular files.
- One `ToolDefinition`, `query_sql`, in the `data` group with `execute` permission.
- A `previewChange` that shows the SQL to be run.

## Consumes

| Contract | From | Fake until it exists |
|---|---|---|
| `DataSourceRegistry` | inspect | Hand-filled registry pointing at fixture files |
| `ResultStore.putRows` | context | In-memory fake |
| `ClankrPaths` (scratch directory) | storage | Temporary `ClankrPaths` |

## Design notes

### Lockdown, in layers

No single check is trusted on its own.

1. **Statement check.** Accept exactly one statement, and only a `SELECT`. Decide this with DuckDB's own parser, not with a regular expression, which a small model's odd formatting or a deliberate trick would defeat.
2. **File access.** Only files in the `DataSourceRegistry` are reachable. Table functions that take a path (`read_csv` and its relatives) must not be able to open anything else, including through a path the model writes into the SQL.
3. **Extensions.** Install and autoload are off. The vendored Excel reader is loaded from disk by the harness before the configuration is locked.
4. **Locked configuration.** After setup, the configuration is locked so a query cannot turn any of the above back on.

Each layer was verified against DuckDB 1.4.5 in the foundation spike; the results are in [foundation.md](foundation.md#spike-findings-2026-11-17). Two findings shape the design: configuration alone does not stop `COPY ... TO` an allowed directory or `CREATE TABLE`, so the statement check is required, and stored row sets must be allowed file by file, not by directory.

### Everything else

- **One connection per session.** It is opened and locked down on first use and reused for every query. A file inspected later in the session has to be added to a connection whose configuration is already locked, so the lockdown design must allow registering a new input file without unlocking anything else. A locked configuration cannot be extended, so the instance is rebuilt with the new file added (D38).
- **The engine has two callers.** `query_sql` runs the model's SQL through it, and [inspect](inspect.md) runs its own fixed profiling queries through it. Only the model's SQL goes through the statement check.
- **The model uses table names, not paths.** The names come from the profile printed by [inspect](inspect.md).
- **Limits.** A query has a timeout that actually interrupts it, a memory limit, and a row limit on what is stored.
- **Scratch files.** When DuckDB spills to disk, it spills into the session's scratch directory, so `clankr wipe` and `--ephemeral` cover it.
- **The result is a row set** stored with its SQL as provenance. The model sees the column names, the row count, the first rows, and the handle.
- **Errors are short and fixable.** For an unknown column, list the columns that exist. For an unknown table, list the tables. Strip internal detail and file paths.
- **The engine is loaded lazily**, on first use.
- **Performance target:** a group-by over 1,000,000 rows in under 5 s (PRD section 9).

## Not in this part

- Profiling and registering files (inspect).
- Reshaping rows in JavaScript (sandbox).
- The approval prompt (permissions).

## Done when

- Each of these is rejected, with a test per case: `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `COPY`, `ATTACH`, `INSTALL`, `LOAD`, a setting change, and two statements in one call.
- A `SELECT` that names a file outside the registry by path is rejected, for a local path and for a URL.
- A query that runs too long is interrupted; one that needs too much memory fails cleanly.
- A group-by over a generated 1,000,000-row file completes in the target time, measured on the reference machine.
- A large result returns a capped preview, and the stored rows can be read back by handle.
- A test confirms no network connection is attempted during any of the above.

## Decisions

Settled 2026-11-17. A D-number means the decision is also recorded in PRD section 13.1.

| Topic | Decision |
|---|---|
| Row-set format | JSON Lines, shared with [context](context.md) and [sandbox](sandbox.md) (D16). |
| Connection lifetime | One connection per session: opened and locked down on first use, rebuilt when a file is registered (D38), closed when the session ends. |
| Binding and version | `@duckdb/node-api` 1.4.5-r.1, DuckDB 1.4.5 (LTS), pinned (D37). |
| How often a query prompts | Once per data file per session (D19). The rule lives in [permissions](permissions.md). |
| Statement check detail | `extractStatements` must find exactly one statement and its prepared `statementType` must be `SELECT`. When preparing fails (an `UPDATE` of a missing table), the parser-only `json_serialize_sql` decides whether it was a `SELECT` at all, so the model is told "not allowed" rather than "table missing". `PIVOT` prepares as `CREATE` (it makes an enum type) and is rejected. |
| Engine module API | `src/engines/duckdb/index.ts`. `sessionEngineFor(context)` keeps one engine per session, keyed by the session's `DataSourceRegistry`; `closeSessionEngine(registry)` closes it at session end. `openLockedDatabase` opens a short-lived locked instance; inspect profiles through it with `tableSourceSql`, so SQL reads a table exactly as inspection did. Only `query_sql` runs the statement check. |
| When the rebuild happens (D38) | Lazily: before the next query, when a fingerprint of the registry differs from the one the instance was built for. A view whose file can no longer be read is skipped; the other tables stay usable. |
| How each table is read | One view per registered table. `.csv`/`.tsv`: `read_csv` with the detected delimiter and `skip` to the header row. `.xlsx`: `read_xlsx` with sheet, cell range, and `ignore_errors` (a cell that does not fit its column is NULL; inspect reports such columns as mixed). Row sets (`.xls`, `.docx`): `read_json` on the row set's file. Each file is allowed by exact path. |
| Excel reader loading | The vendored extension is loaded only when an `.xlsx` table is registered, so CSV-only sessions do not need `npm run vendor`. It lives at `vendor/duckdb-excel/v1.4.5/osx_arm64/excel.duckdb_extension`, pinned by SHA-256 in `scripts/vendor/duckdb-excel.ts`. |
| Limits | Config `data.sqlTimeoutMs` (30 s), `data.sqlMemoryLimitMb` (2048), `data.sqlStoredRowLimit` (1,000,000), `data.sqlPreviewRows` (20). The timeout and the tool call's abort signal both call `interrupt()`. |
| Stored values | BIGINT and DECIMAL are stored as JSON numbers (text only when beyond 2^53), dates and timestamps as ISO text. The provenance carries the SQL in `arguments.sql` and the files read in `dataSourcePaths`. |

## Measurements (2026-11-17, Apple M3 Pro)

- Group-by over a generated 1,000,000-row CSV through `query_sql`, including the engine build: 138 ms (target under 5 s).
- Opening and locking an instance: about 30 ms in the exploration script.
- A runaway query with a 300 ms timeout stops within the test's 3 s bound; the connection keeps working.

## Open questions

None.
