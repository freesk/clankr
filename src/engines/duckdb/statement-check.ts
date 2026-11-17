// The statement check for model-written SQL (DATA-7, specs/sql.md layer 1).
// DuckDB's own parser decides, never a regular expression: exactly one statement,
// and its prepared type must be SELECT. Configuration alone does not stop
// `COPY ... TO` or `CREATE TABLE` (foundation spike), so this layer is required.

import type { DuckDBConnection } from "@duckdb/node-api";
import { ToolError } from "../../contracts/index.ts";
import { loadDuckDb } from "./load-duckdb.ts";
import { quoteLiteral } from "./sql-text.ts";

const onlySelectAdvice = "Only a single read-only SELECT is allowed (WITH ... SELECT is fine).";

/**
 * Throws a ToolError unless `sql` is exactly one SELECT. Errors that are not about
 * the statement kind (a syntax error, an unknown column) are rethrown as they are,
 * for the caller to shape.
 */
export async function assertSingleSelect(connection: DuckDBConnection, sql: string): Promise<void> {
  const { StatementType } = await loadDuckDb();
  const statements = await connection.extractStatements(sql);
  if (statements.count === 0) throw new ToolError(`The SQL is empty. ${onlySelectAdvice}`);
  if (statements.count > 1) {
    throw new ToolError(`Found ${statements.count} statements. ${onlySelectAdvice}`);
  }

  let statementType: number;
  try {
    const prepared = await statements.prepare(0);
    statementType = prepared.statementType;
    prepared.destroySync();
  } catch (error) {
    // Binding failed. A statement that is not a SELECT at all is reported as such,
    // so an UPDATE of a missing table does not read like a missing-table problem.
    if (!(await parsesAsSelect(connection, sql))) throw notSelectError("This statement");
    throw error;
  }
  if (statementType !== StatementType.SELECT) {
    throw notSelectError(`A ${StatementType[statementType] ?? "non-SELECT"} statement`);
  }
}

function notSelectError(what: string): ToolError {
  return new ToolError(`${what} is not allowed. ${onlySelectAdvice}`);
}

/** Parser-only check: `json_serialize_sql` serializes SELECT statements and refuses everything else. */
async function parsesAsSelect(connection: DuckDBConnection, sql: string): Promise<boolean> {
  // It only accepts a constant, so the text goes in as a quoted literal. It is parsed, never run.
  const reader = await connection.runAndReadAll(
    `SELECT json_serialize_sql(${quoteLiteral(sql)}) AS tree`,
  );
  const tree = reader.getRowObjectsJson()[0]?.tree;
  if (typeof tree !== "string") return false;
  return (JSON.parse(tree) as { error?: boolean }).error !== true;
}
