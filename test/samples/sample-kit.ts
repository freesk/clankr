// Shared setup for the samples tests: copies a committed sample into a temporary
// allowed root, inspects it, and runs SQL whose rows come back as values.

import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import type { Row } from "../../src/contracts/index.ts";
import { SessionDataSourceRegistry } from "../../src/data/index.ts";
import {
  createSqlTestContext,
  type SqlTestContext,
} from "../../src/engines/duckdb/testing/sql-test-context.ts";
import { inspectDataTool } from "../../src/tools/data/inspect/inspect-data.ts";
import { querySqlTool } from "../../src/tools/data/query-sql.ts";

export const samplesDirectory = join(import.meta.dirname, "..", "..", "samples");

export interface SampleSession {
  test: SqlTestContext;
  /** Inspects a sample by name and returns the profile text. */
  inspect(name: string): Promise<string>;
  query(sql: string): Promise<Row[]>;
}

export async function openSampleSession(): Promise<SampleSession> {
  const test = await createSqlTestContext({ dataSources: new SessionDataSourceRegistry() });
  return {
    test,
    async inspect(name) {
      const path = join(test.dataDirectory, name);
      await copyFile(join(samplesDirectory, name), path);
      return (await inspectDataTool.run({ path }, test.context)).text;
    },
    async query(sql) {
      const output = await querySqlTool.run({ sql }, test.context);
      const rows: Row[] = [];
      for await (const row of test.results.readRows(output.handles?.[0] ?? "")) rows.push(row);
      return rows;
    },
  };
}

/** Checks the type column of each named column's profile line. */
export function expectColumnTypes(profile: string, types: Record<string, string>): void {
  for (const [column, type] of Object.entries(types)) {
    expect(profile).toContain(`\n${column} | ${type}`);
  }
}

/** Sums `value` per `key`, rounded to cents: the expected side of a GROUP BY. */
export function totalsBy<T>(
  items: T[],
  key: (item: T) => string,
  value: (item: T) => number,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const item of items) totals[key(item)] = (totals[key(item)] ?? 0) + value(item);
  for (const name of Object.keys(totals))
    totals[name] = Math.round((totals[name] ?? 0) * 100) / 100;
  return totals;
}

/** Turns `[{ key, total }]` query rows into a record rounded to cents, for comparison. */
export function rowsToTotals(rows: Row[], key: string, total: string): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) totals[String(row[key])] = Math.round(Number(row[total]) * 100) / 100;
  return totals;
}
