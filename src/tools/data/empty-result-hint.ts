// Why a query returned no rows. A small model that filters on a value the data does not have
// (Gender = 'Total' when the column holds only Female and Male) sees a bare "0 rows" and
// rewrites everything except the bad filter: 14 of 23 calls in one live run. So when a
// result is empty, each simple filter in the SQL is checked on its own, and the ones that
// match nothing are named with the values the column really has.
//
// The probes are harness-written SQL: the column and values are taken out of the model's
// text and quoted again, never pasted back in as written (see sql-text.ts).

import type { DuckDBConnection } from "@duckdb/node-api";
import {
  quoteIdentifier,
  quoteLiteral,
  readAllRows,
  type SessionEngine,
  withQueryLimits,
} from "../../engines/duckdb/index.ts";

/** The hint is a courtesy: it gets a short budget of its own and never fails the query. */
const hintTimeoutMs = 10_000;
/** Each probe scans the table once; past a few filters the model has bigger problems. */
const maximumFiltersChecked = 6;
const valuesShown = 10;

type Literal = { kind: "text"; value: string } | { kind: "number"; value: string };

export interface EqualityFilter {
  column: string;
  values: Literal[];
  /** The filter as the model wrote it, for the message. */
  written: string;
}

const quotedIdentifier = `"(?:[^"]|"")+"`;
const bareIdentifier = "[A-Za-z_][A-Za-z0-9_$]*";
const columnPattern = String.raw`(?:${bareIdentifier}\.)?(${quotedIdentifier}|${bareIdentifier})`;
const literalPattern = String.raw`'(?:[^']|'')*'|-?\d+(?:\.\d+)?`;
// Only a comparison that starts a condition counts: `CASE WHEN "Age" = '90+'` is a value
// mapping, not a filter, and is skipped because it follows WHEN.
const conditionStart = String.raw`\b(?:WHERE|AND|OR|ON|HAVING)\s*\(*\s*`;
const equalityPattern = new RegExp(
  String.raw`${conditionStart}${columnPattern}\s*=\s*(${literalPattern})`,
  "gi",
);
const inListPattern = new RegExp(
  String.raw`${conditionStart}${columnPattern}\s+IN\s*\(\s*((?:${literalPattern})(?:\s*,\s*(?:${literalPattern}))*)\s*\)`,
  "gi",
);

/** `col = 'x'` and `col IN ('x', 'y')` conditions, the ones a wrong value silently empties. */
export function equalityFiltersIn(sql: string): EqualityFilter[] {
  const filters: EqualityFilter[] = [];
  for (const match of sql.matchAll(equalityPattern)) {
    filters.push(filterFrom(match[1] ?? "", [match[2] ?? ""], match[0]));
  }
  for (const match of sql.matchAll(inListPattern)) {
    const literals = (match[2] ?? "").match(new RegExp(literalPattern, "g")) ?? [];
    filters.push(filterFrom(match[1] ?? "", literals, match[0]));
  }
  return filters;
}

function filterFrom(column: string, literals: string[], matched: string): EqualityFilter {
  const written = matched.replace(new RegExp(`^${conditionStart}`, "i"), "").replace(/\s+/g, " ");
  return { column: unquoteIdentifier(column), values: literals.map(parseLiteral), written };
}

function unquoteIdentifier(text: string): string {
  return text.startsWith('"') ? text.slice(1, -1).replaceAll('""', '"') : text;
}

function parseLiteral(text: string): Literal {
  if (text.startsWith("'")) return { kind: "text", value: text.slice(1, -1).replaceAll("''", "'") };
  return { kind: "number", value: text };
}

function literalSql(literal: Literal): string {
  return literal.kind === "text" ? quoteLiteral(literal.value) : literal.value;
}

/** A line or two naming the filters that match no row, or undefined when none can be named. */
export async function emptyResultHint(
  sql: string,
  engine: SessionEngine,
  connection: DuckDBConnection,
  signal?: AbortSignal,
): Promise<string | undefined> {
  try {
    return await withQueryLimits(connection, { timeoutMs: hintTimeoutMs, signal }, async () => {
      const lines: string[] = [];
      for (const [table, filters] of await filtersByTable(sql, engine)) {
        for (const filter of await filtersMatchingNothing(connection, table, filters)) {
          lines.push(await describeEmptyFilter(connection, table, filter));
        }
      }
      return lines.length > 0 ? lines.join("\n") : undefined;
    });
  } catch {
    // A filter on an expression, a type mismatch, or the time budget: no hint, same result.
    return undefined;
  }
}

/** Each filter goes to the one table named in the query that has its column. */
async function filtersByTable(
  sql: string,
  engine: SessionEngine,
): Promise<Map<string, EqualityFilter[]>> {
  const byTable = new Map<string, EqualityFilter[]>();
  const filters = equalityFiltersIn(sql).slice(0, maximumFiltersChecked);
  if (filters.length === 0) return byTable;
  const tables = engine.tablesNamedIn(sql).map((table) => table.sqlName);
  for (const table of tables) {
    const columns = await engine.columnsOf([table]);
    for (const filter of filters) {
      const column = columns.find((name) => name.toLowerCase() === filter.column.toLowerCase());
      if (!column) continue;
      const owned = { ...filter, column };
      byTable.set(table, [...(byTable.get(table) ?? []), owned]);
    }
  }
  return byTable;
}

function conditionSql(filter: EqualityFilter): string {
  return `${quoteIdentifier(filter.column)} IN (${filter.values.map(literalSql).join(", ")})`;
}

/** One scan counts every filter's matches, so the cost is one pass however many there are. */
async function filtersMatchingNothing(
  connection: DuckDBConnection,
  table: string,
  filters: EqualityFilter[],
): Promise<EqualityFilter[]> {
  const counts = filters.map(
    (filter, index) => `count(*) FILTER (WHERE ${conditionSql(filter)}) AS f${index}`,
  );
  const [row] = await readAllRows(
    connection,
    `SELECT ${counts.join(", ")} FROM ${quoteIdentifier(table)}`,
  );
  return filters.filter((_filter, index) => Number(row?.[`f${index}`] ?? 1) === 0);
}

/** For example `No row has "Gender" = 'Total'. Gender has 2 values: Female, Male.` */
async function describeEmptyFilter(
  connection: DuckDBConnection,
  table: string,
  filter: EqualityFilter,
): Promise<string> {
  const { values, distinctValues } = await closestValues(connection, table, filter);
  const opening = `No row has ${filter.written}.`;
  if (distinctValues <= valuesShown) {
    return `${opening} ${filter.column} has ${distinctValues} values: ${values.join(", ")}.`;
  }
  return `${opening} ${filter.column} has ${distinctValues.toLocaleString("en-US")} values; the closest are: ${values.join(", ")}.`;
}

/**
 * The column's values nearest the first one asked for, so a near miss shows its fix, and how
 * many distinct values there are. One scan: on a 100 MB CSV each scan costs seconds.
 */
async function closestValues(
  connection: DuckDBConnection,
  table: string,
  filter: EqualityFilter,
): Promise<{ values: string[]; distinctValues: number }> {
  const column = quoteIdentifier(filter.column);
  const wanted = quoteLiteral((filter.values[0]?.value ?? "").toLowerCase());
  const rows = await readAllRows(
    connection,
    `SELECT value, count(*) OVER () AS distinct_values FROM (` +
      `SELECT DISTINCT ${column}::VARCHAR AS value FROM ${quoteIdentifier(table)} ` +
      `WHERE ${column} IS NOT NULL) ` +
      `ORDER BY jaro_winkler_similarity(lower(value), ${wanted}) DESC, value LIMIT ${valuesShown}`,
  );
  return {
    values: rows.map((row) => String(row.value)),
    distinctValues: Number(rows[0]?.distinct_values ?? 0),
  };
}
