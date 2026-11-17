// The index holds the text of the user's documents, so model-written SQL must have no way to
// it (D91). `query_sql` runs in the locked engine, which may read only inspected data files;
// each attempt below is made as the model would make it.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ToolError } from "../contracts/index.ts";
import {
  createSqlTestContext,
  type SqlTestContext,
} from "../engines/duckdb/testing/sql-test-context.ts";
import { querySqlTool } from "../tools/data/query-sql.ts";
import { indexFileFor } from "./index-location.ts";
import { createIndexWorkspace, type IndexWorkspace } from "./test-support.ts";

let workspace: IndexWorkspace;
let sql: SqlTestContext;
let indexFile: string;

beforeAll(async () => {
  workspace = await createIndexWorkspace();
  await workspace.write("lease.md", "Either party may terminate the agreement early.\n");
  await workspace.index();
  indexFile = indexFileFor(workspace.indexDirectory, workspace.documents);

  sql = await createSqlTestContext();
  const salesPath = await sql.writeFixture("sales.csv", "region,amount\nnorth,10\n");
  sql.register(salesPath, "csv", [{ sqlName: "sales", label: "sales.csv" }]);
});

afterAll(async () => {
  await sql.cleanup();
  await workspace.cleanup();
});

describe("the index is out of reach of query_sql", () => {
  const attempts = (): [string, string][] => [
    ["attaching the index file", `ATTACH '${indexFile}' AS stolen`],
    ["selecting from the file by path", `SELECT * FROM '${indexFile}'`],
    ["reading it as a blob", `SELECT * FROM read_blob('${indexFile}')`],
    ["reading it as text", `SELECT * FROM read_text('${indexFile}')`],
    ["globbing the index directory", `SELECT * FROM glob('${workspace.indexDirectory}/*')`],
    ["naming its tables", "SELECT text FROM chunks"],
  ];

  it("rejects every way of naming it", async () => {
    for (const [what, statement] of attempts()) {
      const failure = await querySqlTool
        .run({ sql: statement }, sql.context)
        .catch((error) => error);
      expect(failure, what).toBeInstanceOf(ToolError);
      expect(failure.message, what).not.toMatch(/terminate the agreement/);
    }
  });

  it("still answers an ordinary query", async () => {
    const output = await querySqlTool.run(
      { sql: "SELECT sum(amount) AS total FROM sales" },
      sql.context,
    );
    expect(output.text).toContain("10");
  });
});
