// DATA-7 and SEC-4: every lockdown layer, exercised through query_sql as the model would.

import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ToolError } from "../../contracts/index.ts";
import { querySqlTool } from "../../tools/data/query-sql.ts";
import { createSqlTestContext, type SqlTestContext } from "./testing/sql-test-context.ts";

let test: SqlTestContext;
let secretPath: string;
let server: Server;
let serverPort = 0;
let connectionsSeen = 0;

beforeAll(async () => {
  test = await createSqlTestContext();
  const salesPath = await test.writeFixture("sales.csv", "region,amount\nnorth,10\nsouth,20\n");
  secretPath = await test.writeFixture("secret.csv", "password\nhunter2\n");
  test.register(salesPath, "csv", [{ sqlName: "sales", label: "sales.csv" }]);
  server = createServer((socket) => {
    connectionsSeen++;
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  serverPort = typeof address === "object" && address ? address.port : 0;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await test.cleanup();
});

async function runSql(sql: string): Promise<string> {
  const output = await querySqlTool.run({ sql }, test.context);
  return output.text;
}

async function rejectionOf(sql: string): Promise<string> {
  try {
    await runSql(sql);
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    return (error as Error).message;
  }
  throw new Error(`Expected the SQL to be rejected: ${sql}`);
}

describe("query_sql lockdown", () => {
  it("runs a SELECT over a registered table", async () => {
    expect(await runSql("SELECT sum(amount) AS total FROM sales")).toContain("30");
  });

  const notSelect: [string, string][] = [
    ["INSERT", "INSERT INTO sales VALUES ('east', 5)"],
    ["UPDATE", "UPDATE sales SET amount = 0"],
    ["DELETE", "DELETE FROM sales"],
    ["CREATE", "CREATE TABLE copy AS SELECT * FROM sales"],
    ["COPY", "COPY (SELECT * FROM sales) TO 'out.csv'"],
    ["ATTACH", "ATTACH 'other.db' AS other"],
    ["INSTALL", "INSTALL httpfs"],
    ["LOAD", "LOAD httpfs"],
    ["SET", "SET enable_external_access = true"],
    ["PRAGMA setting", "PRAGMA memory_limit = '100GB'"],
    ["RESET", "RESET lock_configuration"],
    ["EXPORT", "EXPORT DATABASE 'dump'"],
    ["PIVOT (creates a type)", "PIVOT sales ON region USING sum(amount)"],
  ];
  for (const [kind, sql] of notSelect) {
    it(`rejects ${kind}`, async () => {
      expect(await rejectionOf(sql)).toMatch(/not allowed|Only a single read-only SELECT/);
    });
  }

  it("rejects two statements in one call", async () => {
    expect(await rejectionOf("SELECT 1; SELECT 2")).toMatch(/Found 2 statements/);
  });

  it("rejects a SELECT followed by a write", async () => {
    expect(await rejectionOf("SELECT 1; DROP VIEW sales")).toMatch(/Found 2 statements/);
  });

  it("rejects a file outside the registry by path, without leaking the path", async () => {
    const message = await rejectionOf(`SELECT * FROM read_csv('${secretPath}')`);
    expect(message).toMatch(/only read inspected files/);
    expect(message).not.toContain(test.dataDirectory);
  });

  it("rejects path tricks: relative, glob, and parent segments", async () => {
    const tricks = [
      "SELECT * FROM read_csv('data/secret.csv')",
      `SELECT * FROM read_csv('${join(test.dataDirectory, "*.csv")}')`,
      `SELECT * FROM read_csv('${join(test.dataDirectory, "..", "data", "secret.csv")}')`,
      "SELECT * FROM glob('/*')",
      "SELECT * FROM read_text('/etc/hosts')",
    ];
    for (const sql of tricks) expect(await rejectionOf(sql)).toMatch(/only read inspected files/);
  });

  it("rejects URLs and attempts no network connection", async () => {
    for (const scheme of ["http", "https", "s3"]) {
      const url = `${scheme}://127.0.0.1:${serverPort}/data.csv`;
      const message = await rejectionOf(`SELECT * FROM read_csv('${url}')`);
      expect(message).toMatch(/only read inspected files|not allowed|error/i);
    }
    expect(connectionsSeen).toBe(0);
  });

  it("keeps working after rejections", async () => {
    expect(await runSql("SELECT count(*) AS n FROM sales")).toContain("2");
  });
});
