// Each fixture generator produces a real file of its format.

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { looksLikePdf } from "./generators/pdf.ts";
import { ensureCachedCsv, materializeFixtures } from "./materialize.ts";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "clankr-evals-fixtures-test-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("materializeFixtures", () => {
  it("writes text and folders, sets modification times, and snapshots content", async () => {
    const snapshot = await materializeFixtures(directory, [
      { kind: "text", path: "a/b.txt", content: "hello", modifiedAt: "2025-04-12T10:00:00Z" },
      { kind: "directory", path: "empty" },
    ]);
    expect(await readFile(join(directory, "a/b.txt"), "utf8")).toBe("hello");
    expect((await stat(join(directory, "a/b.txt"))).mtime.toISOString()).toBe(
      "2025-04-12T10:00:00.000Z",
    );
    expect((await stat(join(directory, "empty"))).isDirectory()).toBe(true);
    expect([...snapshot.keys()]).toEqual(["a/b.txt"]);
  });

  it("generates a PNG with the expected size", async () => {
    await materializeFixtures(directory, [
      { kind: "generated", generator: "png-shape", path: "shape.png", options: { color: "red" } },
      {
        kind: "generated",
        generator: "png-text",
        path: "text.png",
        options: { lines: ["TOTAL $1.00"] },
      },
    ]);
    const shape = await readFile(join(directory, "shape.png"));
    expect(shape.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(shape.readUInt32BE(16)).toBe(200);
    const text = await readFile(join(directory, "text.png"));
    expect(text.readUInt32BE(16)).toBe(16 * 2 + 11 * 6 * 4);
  });

  it("refuses text it cannot draw", async () => {
    await expect(
      materializeFixtures(directory, [
        { kind: "generated", generator: "png-text", path: "x.png", options: { lines: ["€"] } },
      ]),
    ).rejects.toThrow("cannot draw");
  });

  it("generates an .xlsx that SheetJS reads back", async () => {
    await materializeFixtures(directory, [
      {
        kind: "generated",
        generator: "xlsx",
        path: "payroll.xlsx",
        options: { dataset: "payroll" },
      },
    ]);
    const workbook = XLSX.read(await readFile(join(directory, "payroll.xlsx")));
    const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet ?? {});
    expect(rows).toHaveLength(24);
    expect(rows[0]).toMatchObject({ employee_id: "E001", department: "Engineering" });
  });

  it("generates a CSV with a header and the requested rows", async () => {
    await materializeFixtures(directory, [
      {
        kind: "generated",
        generator: "csv",
        path: "sales.csv",
        options: { dataset: "sales", rows: 10 },
      },
    ]);
    const lines = (await readFile(join(directory, "sales.csv"), "utf8")).trimEnd().split("\n");
    expect(lines[0]).toBe("order_id,order_date,region,product,quantity,unit_price");
    expect(lines).toHaveLength(11);
    expect(lines[1]).toBe("1,2025-01-01,North,Widget,1,2.5");
  });

  it("generates a .docx: a ZIP whose document holds both tables", async () => {
    await materializeFixtures(directory, [
      {
        kind: "generated",
        generator: "docx",
        path: "report.docx",
        options: { document: "board-report" },
      },
    ]);
    const content = await readFile(join(directory, "report.docx"));
    expect(content.readUInt32LE(0)).toBe(0x04034b50);
    expect(content.readUInt32LE(content.length - 22)).toBe(0x06054b50);
    const text = content.toString("utf8");
    expect(text).toContain("word/document.xml");
    expect(text).toContain("Headcount by office");
    expect(text).toContain("<w:tbl>");
  });

  it("generates a valid PDF", async () => {
    await materializeFixtures(directory, [
      {
        kind: "generated",
        generator: "pdf",
        path: "lease.pdf",
        options: { lines: ["Lease (synthetic)"] },
      },
    ]);
    expect(looksLikePdf(await readFile(join(directory, "lease.pdf")))).toBe(true);
  });
});

describe("ensureCachedCsv", () => {
  it("generates once and reuses the cached file", async () => {
    const table = { dataset: "sales" as const, rows: 50, sheetName: "Sheet1" };
    const first = await ensureCachedCsv(table, join(directory, "cache"));
    const firstModified = (await stat(first)).mtimeMs;
    const second = await ensureCachedCsv(table, join(directory, "cache"));
    expect(second).toBe(first);
    expect((await stat(second)).mtimeMs).toBe(firstModified);
  });
});
