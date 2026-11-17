import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { baseNameFromTitle, chooseOutputPaths, splitOutputPath } from "./output-naming.ts";

describe("baseNameFromTitle", () => {
  it.each([
    [{ title: "Revenue by Region, 2026" }, "revenue-by-region-2026"],
    [{ title: { text: "Héadcount / Q1" } }, "héadcount-q1"],
    [{ title: ["Two", "lines"] }, "two-lines"],
    [{ mark: "bar" }, "chart"],
    [{ title: "!!!" }, "chart"],
  ])("names %j as %s", (spec, expected) => {
    expect(baseNameFromTitle(spec)).toBe(expected);
  });
});

describe("chooseOutputPaths", () => {
  let folder: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "clankr-naming-"));
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it("uses the plain name when it is free, with companions beside it", async () => {
    const paths = await chooseOutputPaths(folder, "sales", "pdf");
    expect(paths).toEqual({
      chart: join(folder, "sales.pdf"),
      code: join(folder, "sales.chart.js"),
      specs: [join(folder, "sales.vl.json")],
      sql: join(folder, "sales.sql"),
      format: "pdf",
    });
  });

  it("numbers the spec files of several charts and checks each for a clash", async () => {
    const paths = await chooseOutputPaths(folder, "sales", "pdf", 3);
    expect(paths.specs).toEqual([1, 2, 3].map((n) => join(folder, `sales.${n}.vl.json`)));
    await writeFile(join(folder, "sales.2.vl.json"), "");
    const next = await chooseOutputPaths(folder, "sales", "pdf", 3);
    expect(next.chart).toBe(join(folder, "sales-2.pdf"));
  });

  it("appends a number when the chart or any companion exists", async () => {
    await writeFile(join(folder, "sales.pdf"), "");
    await writeFile(join(folder, "sales-2.sql"), "");
    const paths = await chooseOutputPaths(folder, "sales", "pdf");
    expect(paths.chart).toBe(join(folder, "sales-3.pdf"));
  });

  it("splits an explicit path into folder and base name", () => {
    expect(splitOutputPath("/a/b/q1 report.pdf")).toEqual({
      folder: "/a/b",
      baseName: "q1 report",
    });
    expect(splitOutputPath("/a/b/notes")).toEqual({ folder: "/a/b", baseName: "notes" });
  });
});
