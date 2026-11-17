// Opt-in measurements for PRD section 9 and DATA-4: `CLANKR_PERF=1 npx vitest run perf`.
// Fixtures are generated here, never committed. Each profile runs in a child process
// so its peak memory (RSS, DuckDB included) is measured on its own.

import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isExcelExtensionInstalled } from "../../../engines/duckdb/index.ts";
import { excelExtensionPath, loadDuckDb } from "../../../engines/duckdb/load-duckdb.ts";

const run = promisify(execFile);
const helper = join(import.meta.dirname, "perf", "profile-once.ts");
let directory: string;

interface Measurement {
  elapsedMs: number;
  peakRssMb: number;
  firstLine: string;
}

async function profileInChild(path: string): Promise<Measurement> {
  const { stdout } = await run(process.execPath, [helper, path], { maxBuffer: 1 << 20 });
  return JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as Measurement;
}

async function writeCsv(path: string, rowCount: number): Promise<void> {
  const stream = createWriteStream(path);
  stream.write("id,department,amount,booked_on,comment\n");
  for (let id = 0; id < rowCount; id++) {
    const day = String(1 + (id % 28)).padStart(2, "0");
    const line = `${id},dept_${id % 50},${(id % 1000) / 10},2024-02-${day},note ${id % 9973}\n`;
    if (!stream.write(line)) await new Promise<void>((resolve) => stream.once("drain", resolve));
  }
  await new Promise<void>((resolve) => stream.end(() => resolve()));
}

describe.runIf(process.env.CLANKR_PERF === "1")("inspect_data performance", () => {
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "clankr-perf-"));
  });
  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("profiles 1,000,000 and 2,000,000 CSV rows with flat memory (DATA-4)", async () => {
    const results: Record<string, Measurement & { sizeMb: number }> = {};
    for (const rowCount of [1_000_000, 2_000_000]) {
      const path = join(directory, `rows_${rowCount}.csv`);
      await writeCsv(path, rowCount);
      const sizeMb = Math.round((await stat(path)).size / 1024 / 1024);
      results[rowCount] = { ...(await profileInChild(path)), sizeMb };
    }
    console.log("CSV profile measurements:", JSON.stringify(results, null, 2));
    const small = results[1_000_000];
    const large = results[2_000_000];
    expect(small?.firstLine).toContain("1,000,000 rows");
    // Doubling the file must not grow peak memory proportionally.
    expect(large?.peakRssMb ?? Infinity).toBeLessThan((small?.peakRssMb ?? 0) * 1.5);
  }, 300_000);

  it.runIf(isExcelExtensionInstalled())(
    "profiles a ~100 MB .xlsx in under 10 s (PRD section 9)",
    async () => {
      const path = join(directory, "large.xlsx");
      const { DuckDBInstance } = await loadDuckDb();
      const instance = await DuckDBInstance.create(":memory:");
      const connection = await instance.connect();
      await connection.run(`LOAD '${excelExtensionPath}'`);
      await connection.run(
        `COPY (SELECT i AS id, 'dept_' || (i % 50) AS department, (i % 1000) / 10 AS amount,
           DATE '2024-01-01' + (i % 365)::INTEGER AS booked_on, md5(i::VARCHAR) AS reference,
           md5((i * 7)::VARCHAR) AS checksum, 'customer ' || (i % 20011) AS customer,
           md5((i * 13)::VARCHAR) AS batch, (i % 7919) * 1.25 AS fee
         FROM range(1000000) t(i)) TO '${path}' (FORMAT xlsx, HEADER true)`,
      );
      connection.closeSync();
      instance.closeSync();
      const sizeMb = Math.round((await stat(path)).size / 1024 / 1024);
      const measurement = await profileInChild(path);
      console.log("xlsx profile measurement:", JSON.stringify({ sizeMb, ...measurement }));
      expect(measurement.firstLine).toContain("1,000,000 rows");
      expect(measurement.elapsedMs).toBeLessThan(10_000);
    },
    600_000,
  );
});
