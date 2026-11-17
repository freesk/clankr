// sql part: the locked-down DuckDB engine (specs/sql.md). Nothing here loads DuckDB
// at import time; the native addon is imported on first use.
// inspect uses `openLockedDatabase`, `tableSourceSql`, and `readAllRows` to profile files.

export { isExcelExtensionInstalled } from "./load-duckdb.ts";
export {
  type LockedDatabase,
  type LockedDatabaseOptions,
  openLockedDatabase,
} from "./locked-database.ts";
export { shapeQueryError, stripPaths } from "./query-errors.ts";
export {
  QueryInterruptedError,
  type QueryLimits,
  type RowStream,
  readAllRows,
  streamRows,
  withQueryLimits,
} from "./run-query.ts";
export {
  closeSessionEngine,
  type RegisteredTable,
  SessionEngine,
  sessionEngineFor,
} from "./session-engine.ts";
export { quoteIdentifier, quoteLiteral } from "./sql-text.ts";
export { assertSingleSelect } from "./statement-check.ts";
export {
  fileReadBy,
  readsExcel,
  type TableSourceInput,
  tableSourceSql,
  type XlsxReadMode,
} from "./table-source.ts";
