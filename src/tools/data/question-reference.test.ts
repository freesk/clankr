// The worked SQL in the data-question reference must run and give the right answer: a broken
// example would teach the model broken SQL. Runs both examples on synthetic data in DuckDB.

import { describe, expect, it } from "vitest";
import { dataQuestionReference, dataQuestionText } from "./question-reference.ts";

/** The SQL lines of the reference, in order (each starts with SELECT). */
function exampleQueries(): string[] {
  return dataQuestionText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("SELECT"));
}

async function run(setup: string, query: string): Promise<Record<string, unknown>[]> {
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const connection = await (await DuckDBInstance.create(":memory:")).connect();
  await connection.run(setup);
  return (await connection.runAndReadAll(query)).getRowObjectsJson();
}

describe("data question reference", () => {
  it("averages nightly totals per city, not per shelter", async () => {
    const [averaging] = exampleQueries();
    // Two shelters in Calgary each night: nightly totals 30 and 50, so the average is 40.
    const rows = await run(
      `CREATE TABLE t AS SELECT * FROM (VALUES
        ('Calgary', 2024, DATE '2024-01-01', 10), ('Calgary', 2024, DATE '2024-01-01', 20),
        ('Calgary', 2024, DATE '2024-01-02', 20), ('Calgary', 2024, DATE '2024-01-02', 30))
        AS v(city, year, date, occupancy)`,
      averaging ?? "",
    );
    expect(rows).toEqual([{ city: "Calgary", year: 2024, avg_nightly: 40 }]);
  });

  it("orders months from April to March for a fiscal year", async () => {
    const [, fiscal] = exampleQueries();
    const rows = await run(
      `CREATE TABLE t AS SELECT * FROM (VALUES
        (DATE '2025-03-15', 3), (DATE '2024-04-10', 4), (DATE '2024-12-01', 12), (DATE '2025-01-05', 1))
        AS v(paid_on, amount)`,
      fiscal ?? "",
    );
    expect(rows.map((row) => row.month)).toEqual(["Apr", "Dec", "Jan", "Mar"]);
  });

  it("is loaded for questions about averages and fiscal months", () => {
    const words = dataQuestionReference.triggerWords;
    expect(words.some((word) => "average nightly overnight occupancy".includes(word))).toBe(true);
    expect(words.some((word) => "per month of the fiscal year".includes(word))).toBe(true);
  });
});
