// What one row stands for, when a table is a time series by some category: "about one
// ShelterName per date". In live runs the model averaged rows straight into "average nightly
// occupancy per city", giving a per-shelter figure (151) instead of the city's nightly total
// (2,166), even with guidance in the system prompt. Profile notes are what it acts on.

import type { DuckDBConnection } from "@duckdb/node-api";
import { quoteIdentifier, readAllRows } from "../../../engines/duckdb/index.ts";
import type { ColumnProfile, TableStatistics } from "./column-profile.ts";

export interface RowGrain {
  timeColumn: string;
  /** The column that, with the time column, (almost) identifies a row. */
  keyColumn: string;
  /** Category columns with several rows per time value: totals per these need a SUM first. */
  groupingColumns: string[];
}

/** Real exports repeat a few rows, so a pair covering 99% of rows counts as the grain. */
const nearlyUnique = 0.99;
const candidatesTried = 6;

export async function findRowGrain(
  connection: DuckDBConnection,
  sourceSql: string,
  statistics: TableStatistics,
): Promise<RowGrain | undefined> {
  const { rowCount, columns } = statistics;
  const time = columns.find((column) => column.type === "date");
  if (!time || rowCount < 100) return undefined;
  const categories = columns
    .filter((column) => column !== time && column.type === "text")
    .filter((column) => column.distinctCount >= 2 && column.distinctCount < rowCount / 2)
    .sort((a, b) => a.distinctCount - b.distinctCount)
    .slice(0, candidatesTried);
  const pairs = await distinctPairCounts(connection, sourceSql, time, categories);
  const key = categories.find((column) => (pairs.get(column.name) ?? 0) >= rowCount * nearlyUnique);
  if (!key) return undefined;
  const groupingColumns = categories
    .filter((column) => column !== key && (pairs.get(column.name) ?? rowCount) < rowCount / 2)
    .map((column) => column.name);
  return { timeColumn: time.name, keyColumn: key.name, groupingColumns };
}

/** For each category, how many distinct (time, category) pairs the table has. */
async function distinctPairCounts(
  connection: DuckDBConnection,
  sourceSql: string,
  time: ColumnProfile,
  categories: ColumnProfile[],
): Promise<Map<string, number>> {
  if (categories.length === 0) return new Map();
  const timeName = quoteIdentifier(time.name);
  const counts = categories.map(
    (column, index) =>
      `count(DISTINCT (${timeName}, ${quoteIdentifier(column.name)})) AS c${index}`,
  );
  const [row] = await readAllRows(connection, `SELECT ${counts.join(", ")} FROM ${sourceSql}`);
  return new Map(categories.map((column, index) => [column.name, Number(row?.[`c${index}`] ?? 0)]));
}
