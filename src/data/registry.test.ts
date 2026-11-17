import { describe, expect, it } from "vitest";
import type { DataSource } from "../contracts/index.ts";
import { SessionDataSourceRegistry } from "./session-data-source-registry.ts";
import { allocateTableNames } from "./table-names.ts";

function source(realPath: string, sqlNames: string[], handle = "r1"): DataSource {
  return {
    handle,
    realPath,
    format: "xlsx",
    tables: sqlNames.map((sqlName) => ({ sqlName, label: sqlName })),
  };
}

describe("SessionDataSourceRegistry", () => {
  it("finds a source by handle, path, or table name, and replaces a re-inspected path", () => {
    const registry = new SessionDataSourceRegistry();
    registry.register(source("/data/pay.xlsx", ["pay"], "r1"));
    registry.register(source("/data/sales.csv", ["sales"], "r2"));
    expect(registry.find("r2")?.realPath).toBe("/data/sales.csv");
    expect(registry.find("/data/pay.xlsx")?.handle).toBe("r1");
    expect(registry.findByTable("SALES")?.realPath).toBe("/data/sales.csv");
    registry.register(source("/data/pay.xlsx", ["pay"], "r9"));
    expect(registry.list().map((entry) => entry.handle)).toEqual(["r2", "r9"]);
    expect(registry.find("r1")).toBeUndefined();
  });
});

describe("allocateTableNames", () => {
  it("names a single table after the file and several after file and label", () => {
    const registry = new SessionDataSourceRegistry();
    expect(allocateTableNames(registry, "/d/Payroll 2025 (final).xlsx", ["Sheet1"])).toEqual([
      "payroll_2025_final",
    ]);
    expect(allocateTableNames(registry, "/d/Board Report.docx", ["table 1", "table 2"])).toEqual([
      "board_report_table_1",
      "board_report_table_2",
    ]);
  });

  it("keeps names plain identifiers", () => {
    const registry = new SessionDataSourceRegistry();
    expect(allocateTableNames(registry, "/d/2025.csv", ["x"])).toEqual(["t_2025"]);
    expect(allocateTableNames(registry, "/d/order.csv", ["x"])).toEqual(["order_data"]);
    expect(allocateTableNames(registry, "/d/Café Ümlaut.csv", ["x"])).toEqual(["cafe_umlaut"]);
  });

  it("is stable for the same file and unique across files", () => {
    const registry = new SessionDataSourceRegistry();
    registry.register(source("/a/sales.csv", ["sales"]));
    expect(allocateTableNames(registry, "/a/sales.csv", ["sales.csv"])).toEqual(["sales"]);
    expect(allocateTableNames(registry, "/b/sales.csv", ["sales.csv"])).toEqual(["sales_2"]);
  });
});
