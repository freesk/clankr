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
| `VixPaths` (scratch directory) | storage | Temporary `VixPaths` |

## Design notes

### Lockdown, in layers

No single check is trusted on its own.

1. **Statement check.** Accept exactly one statement, and only a `SELECT`. Decide this with DuckDB's own parser, not with a regular expression, which a small model's odd formatting or a deliberate trick would defeat.
2. **File access.** Only files in the `DataSourceRegistry` are reachable. Table functions that take a path (`read_csv` and its relatives) must not be able to open anything else, including through a path the model writes into the SQL.
3. **Extensions.** Install and autoload are off. The vendored Excel reader is loaded from disk by the harness before the configuration is locked.
4. **Locked configuration.** After setup, the configuration is locked so a query cannot turn any of the above back on.

Verify each layer against the pinned DuckDB version during the foundation spike, since the available settings differ between versions.

### Everything else

- **One connection per session.** It is opened and locked down on first use and reused for every query. A file inspected later in the session has to be added to a connection whose configuration is already locked, so the lockdown design must allow registering a new input file without unlocking anything else. Settle how in the spike.
- **The engine has two callers.** `query_sql` runs the model's SQL through it, and [inspect](inspect.md) runs its own fixed profiling queries through it. Only the model's SQL goes through the statement check.
- **The model uses table names, not paths.** The names come from the profile printed by [inspect](inspect.md).
- **Limits.** A query has a timeout that actually interrupts it, a memory limit, and a row limit on what is stored.
- **Scratch files.** When DuckDB spills to disk, it spills into the session's scratch directory, so `vix wipe` and `--ephemeral` cover it.
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
| Connection lifetime | One connection per session: opened and locked down on first use, closed when the session ends. |
| How often a query prompts | Once per data file per session (D19). The rule lives in [permissions](permissions.md). |

## Open questions

- Which Node binding for DuckDB, and which version is pinned? Answered by the foundation spike.
