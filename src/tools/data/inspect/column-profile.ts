// Per-column statistics for one table (DATA-2), computed by DuckDB in a few passes
// that stream the file: one for counts, nulls, distincts, and min/max, and one over
// the first rows for samples. Distinct counts are exact for small tables and
// approximate (HyperLogLog) above that, so memory stays flat (DATA-4).

import type { DuckDBConnection } from "@duckdb/node-api";
import type { Row } from "../../../contracts/index.ts";
import { quoteIdentifier, readAllRows } from "../../../engines/duckdb/index.ts";

export type ColumnType = "number" | "date" | "boolean" | "text" | "mixed" | "other";

export interface ColumnProfile {
  name: string;
  type: ColumnType;
  /** DuckDB's type, for "other" columns. */
  sqlType: string;
  nullCount: number;
  distinctCount: number;
  distinctApproximate: boolean;
  min: string | null;
  max: string | null;
  samples: string[];
  /** For mixed columns: what SQL sees. */
  note?: string;
}

export interface TableStatistics {
  rowCount: number;
  columns: ColumnProfile[];
}

export interface ProfileSource {
  /** Typed read, as SQL will see it. */
  sql: string;
  /**
   * `.xlsx` only. The typed read that fails on a cell it cannot convert, tried first: a
   * clean sheet then needs one pass. When it fails, the column is mixed, and `textSql`
   * (every cell as text) is counted to find the cells SQL sees as NULL.
   */
  mixedCheck?: { strictSql: string; textSql: string };
}

const exactDistinctRowLimit = 100_000;
const sampleRowLimit = 1_000;
const sampleCount = 3;

export async function profileTable(
  connection: DuckDBConnection,
  source: ProfileSource,
): Promise<TableStatistics> {
  const described = await readAllRows(connection, `DESCRIBE SELECT * FROM ${source.sql}`);
  const columns = described.map((row) => ({
    name: String(row.column_name),
    sqlType: String(row.column_type),
  }));
  const { stats, textCounts } = await statisticsWithMixedCheck(connection, source, columns);
  const rowCount = Number(stats.row_count ?? 0);
  const exact = rowCount <= exactDistinctRowLimit;
  const distinct = exact ? await exactDistinctCounts(connection, source.sql, columns) : undefined;
  const samples = (await readAllRows(connection, samplesSql(source.sql, columns)))[0] ?? {};

  return {
    rowCount,
    columns: columns.map((column, index) =>
      buildColumnProfile(column, index, { stats, distinct, samples, textCounts, rowCount }),
    ),
  };
}

async function statisticsWithMixedCheck(
  connection: DuckDBConnection,
  source: ProfileSource,
  columns: { name: string; sqlType: string }[],
): Promise<{ stats: Row; textCounts?: Row }> {
  const statisticsOf = async (sql: string) =>
    (await readAllRows(connection, statisticsSql(sql, columns)))[0] ?? {};
  if (!source.mixedCheck) return { stats: await statisticsOf(source.sql) };
  try {
    return { stats: await statisticsOf(source.mixedCheck.strictSql) };
  } catch (error) {
    if (!/Failed to parse cell/.test(String(error))) throw error;
  }
  const stats = await statisticsOf(source.sql);
  const textCounts = (
    await readAllRows(connection, textCountsSql(source.mixedCheck.textSql, columns))
  )[0];
  return textCounts ? { stats, textCounts } : { stats };
}

interface ColumnFacts {
  stats: Row;
  distinct: Row | undefined;
  samples: Row;
  textCounts: Row | undefined;
  rowCount: number;
}

function buildColumnProfile(
  column: { name: string; sqlType: string },
  index: number,
  facts: ColumnFacts,
): ColumnProfile {
  const nonNull = Number(facts.stats[`c${index}_count`] ?? 0);
  const numeric = Number(facts.stats[`c${index}_numeric`] ?? 0);
  const textCount = Number(facts.textCounts?.[`c${index}_count`] ?? nonNull);
  const exactDistinct = facts.distinct?.[`c${index}_distinct`];
  const type = columnType(column.sqlType);
  const tidy = type === "number" ? withoutZeroFraction : (value: string) => value;
  const profile: ColumnProfile = {
    name: column.name,
    type,
    sqlType: column.sqlType,
    nullCount: facts.rowCount - nonNull,
    distinctCount: Number(exactDistinct ?? facts.stats[`c${index}_approx_distinct`] ?? 0),
    distinctApproximate: exactDistinct === undefined,
    min: textOrNull(facts.stats[`c${index}_min`], tidy),
    max: textOrNull(facts.stats[`c${index}_max`], tidy),
    samples: sampleValues(facts.samples[`c${index}_samples`]).map(tidy),
  };
  if (type === "text" && numeric > 0 && numeric < nonNull) {
    profile.type = "mixed";
    profile.note = `${nonNull - numeric} of ${nonNull} values are not numbers; SQL sees text`;
  } else if (type !== "text" && textCount > nonNull) {
    // The typed read turned cells it could not convert into NULL (`.xlsx` only).
    const unreadable = textCount - nonNull;
    profile.type = "mixed";
    profile.note = `${unreadable} value${unreadable === 1 ? " is" : "s are"} not ${type}; NULL in SQL`;
    profile.nullCount = facts.rowCount - textCount;
  }
  return profile;
}

/** DuckDB prints whole doubles as "1000.0"; the profile shows "1000". */
function withoutZeroFraction(value: string): string {
  return value.replace(/^(-?\d+)\.0$/, "$1");
}

export function columnType(sqlType: string): ColumnType {
  const base = sqlType.replace(/\(.*$/, "").toUpperCase();
  if (base === "VARCHAR") return "text";
  if (base === "BOOLEAN") return "boolean";
  if (/^(DATE|TIMESTAMP|TIME)/.test(base)) return "date";
  if (/^(U?(TINY|SMALL|BIG|HUGE)?INT(EGER)?|FLOAT|DOUBLE|DECIMAL|REAL)$/.test(base))
    return "number";
  return "other";
}

function isScalar(sqlType: string): boolean {
  return columnType(sqlType) !== "other";
}

function statisticsSql(sourceSql: string, columns: { name: string; sqlType: string }[]): string {
  const parts = ["count(*) AS row_count"];
  columns.forEach((column, index) => {
    const name = quoteIdentifier(column.name);
    parts.push(`count(${name}) AS c${index}_count`);
    if (!isScalar(column.sqlType)) return;
    parts.push(`approx_count_distinct(${name}) AS c${index}_approx_distinct`);
    parts.push(`min(${name})::VARCHAR AS c${index}_min`, `max(${name})::VARCHAR AS c${index}_max`);
    if (columnType(column.sqlType) === "text") {
      parts.push(`count(TRY_CAST(${name} AS DOUBLE)) AS c${index}_numeric`);
    }
  });
  return `SELECT ${parts.join(", ")} FROM ${sourceSql}`;
}

async function exactDistinctCounts(
  connection: DuckDBConnection,
  sourceSql: string,
  columns: { name: string; sqlType: string }[],
): Promise<Row | undefined> {
  const parts = columns.flatMap((column, index) =>
    isScalar(column.sqlType)
      ? [`count(DISTINCT ${quoteIdentifier(column.name)}) AS c${index}_distinct`]
      : [],
  );
  if (parts.length === 0) return undefined;
  return (await readAllRows(connection, `SELECT ${parts.join(", ")} FROM ${sourceSql}`))[0];
}

function samplesSql(sourceSql: string, columns: { name: string }[]): string {
  const parts = columns.map((column, index) => {
    const name = quoteIdentifier(column.name);
    return `(list(DISTINCT ${name}::VARCHAR) FILTER (WHERE ${name} IS NOT NULL))[1:${sampleCount}] AS c${index}_samples`;
  });
  return `SELECT ${parts.join(", ")} FROM (SELECT * FROM ${sourceSql} LIMIT ${sampleRowLimit})`;
}

function textCountsSql(textSql: string, columns: { name: string }[]): string {
  const parts = columns.map(
    (column, index) => `count(${quoteIdentifier(column.name)}) AS c${index}_count`,
  );
  return `SELECT ${parts.join(", ")} FROM ${textSql}`;
}

function textOrNull(value: unknown, tidy: (text: string) => string): string | null {
  return value === null || value === undefined ? null : tidy(String(value));
}

function sampleValues(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}
