// Throwaway spike (foundation spec, section 6): confirms the native addons and
// spreadsheet readers that M4 depends on build and run on this machine.
// It is the only place allowed to fetch a DuckDB extension at run time, because
// it runs once by hand; the real engine loads the extension from vendor/.
//
// Run with: npm run spike
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DuckDBInstance, StatementType } from "@duckdb/node-api";
import ivm from "isolated-vm";
import * as XLSX from "xlsx";

const scratchDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "vix-spike-"));

async function checkIsolate(): Promise<void> {
  const isolate = new ivm.Isolate({ memoryLimit: 32 });
  const context = await isolate.createContext();
  const result = await context.eval("[1, 2, 3].map((x) => x * 2).join(',')", { timeout: 1000 });
  const hostApis = await context.eval("[typeof require, typeof process, typeof fetch].join(',')");
  console.log(`isolate evaluation: ${result}`);
  console.log(`host APIs inside the isolate (require, process, fetch): ${hostApis}`);
  isolate.dispose();
}

async function checkDuckDb(): Promise<void> {
  const instance = await DuckDBInstance.create(":memory:", {
    extension_directory: path.join(scratchDirectory, "extensions"),
  });
  const connection = await instance.connect();
  const query = async (sql: string) => (await connection.runAndReadAll(sql)).getRowObjectsJson();

  console.log("duckdb version:", await query("SELECT version() AS version"));
  console.log(
    "duckdb group-by over 1,000,000 rows:",
    await query("SELECT i % 3 AS g, count(*) AS n FROM range(1000000) t(i) GROUP BY g ORDER BY g"),
  );

  await connection.run("INSTALL excel; LOAD excel;");
  const xlsxPath = path.join(scratchDirectory, "sample.xlsx");
  await connection.run(
    `COPY (SELECT i AS id, 'name' || i AS name, i * 1.5 AS amount FROM range(3) t(i))
     TO '${xlsxPath}' (FORMAT xlsx, HEADER true)`,
  );
  console.log(
    "xlsx through duckdb read_xlsx:",
    await query(`SELECT * FROM read_xlsx('${xlsxPath}')`),
  );
  await checkDuckDbLockdown(xlsxPath);
}

// specs/sql.md asks the spike to verify each lockdown layer on the pinned version.
async function checkDuckDbLockdown(allowedFile: string): Promise<void> {
  const extensionFile = path.join(
    scratchDirectory,
    "extensions",
    "v1.4.5",
    "osx_arm64",
    "excel.duckdb_extension",
  );
  const secretFile = path.join(scratchDirectory, "secret.csv");
  fs.writeFileSync(secretFile, "secret\nTOP\n");

  const started = Date.now();
  const instance = await DuckDBInstance.create(":memory:", {
    autoinstall_known_extensions: "false",
    autoload_known_extensions: "false",
    allow_community_extensions: "false",
    allow_unsigned_extensions: "false",
  });
  const connection = await instance.connect();
  await connection.run(`LOAD '${extensionFile}'`);
  await connection.run(`SET allowed_paths = ['${allowedFile}']`);
  await connection.run("SET enable_external_access = false");
  await connection.run("SET lock_configuration = true");
  console.log(`locked connection opened in ${Date.now() - started} ms`);

  const attempts: [string, string][] = [
    ["registered xlsx", `SELECT count(*) AS n FROM read_xlsx('${allowedFile}')`],
    ["unregistered file", `SELECT * FROM read_csv('${secretFile}')`],
    ["URL", "SELECT * FROM read_csv('https://example.com/x.csv')"],
    ["setting change", "SET enable_external_access = true"],
    ["INSTALL", "INSTALL httpfs"],
    ["ATTACH", `ATTACH '${path.join(scratchDirectory, "x.db")}'`],
  ];
  for (const [label, sql] of attempts) {
    try {
      await connection.run(sql);
      console.log(`lockdown: ${label} allowed`);
    } catch (error) {
      console.log(`lockdown: ${label} rejected (${(error as Error).message.split(" - ")[0]})`);
    }
  }

  const twoStatements = await connection.extractStatements("SELECT 1; SELECT 2");
  const create = await (await connection.extractStatements("CREATE TABLE t AS SELECT 1")).prepare(
    0,
  );
  console.log(
    `parser: "SELECT 1; SELECT 2" has ${twoStatements.count} statements; CREATE has type ${StatementType[create.statementType]} (SELECT is ${StatementType.SELECT})`,
  );
}

function checkLegacyXls(): void {
  XLSX.set_fs(fs);
  const xlsPath = path.join(scratchDirectory, "sample.xls");
  const rows = Array.from({ length: 65535 }, (_, i) => ({
    id: i,
    department: ["ops", "eng"][i % 2],
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Sheet1");
  XLSX.writeFile(workbook, xlsPath, { bookType: "biff8" });

  const started = Date.now();
  const readBack = XLSX.readFile(xlsPath, { dense: true });
  const firstSheet = readBack.Sheets[readBack.SheetNames[0] ?? ""];
  const readRows = firstSheet ? XLSX.utils.sheet_to_json(firstSheet) : [];
  console.log(`xls through SheetJS: ${readRows.length} rows in ${Date.now() - started} ms`);
}

try {
  console.log(`node ${process.version} on ${process.platform}/${process.arch}`);
  await checkIsolate();
  await checkDuckDb();
  checkLegacyXls();
  console.log("spike ok");
} finally {
  fs.rmSync(scratchDirectory, { recursive: true, force: true });
}
