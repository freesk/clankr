import { describe, expect, it } from "vitest";
import type { IsolateLimits } from "../../contracts/index.ts";
import { InMemoryResultStore } from "../../testing/index.ts";
import { createStandardHelpers, runInIsolate } from "./index.ts";

const limits: IsolateLimits = { timeoutMs: 1_000, memoryLimitMb: 32, rowCap: 5 };

async function storeWithRows(rowCount: number) {
  const results = new InMemoryResultStore();
  const rows = Array.from({ length: rowCount }, (_, index) => ({ id: index, name: `n${index}` }));
  const handle = await results.putRows(rows, { tool: "query_sql", arguments: { sql: "SELECT 1" } });
  return { results, handle };
}

async function run(code: string, results: InMemoryResultStore) {
  return await runInIsolate(code, createStandardHelpers(results, limits), limits);
}

describe("data()", () => {
  it("returns the stored rows as plain isolate values", async () => {
    const { results, handle } = await storeWithRows(3);
    const result = await run(`data("${handle}").map((row) => row.id)`, results);
    expect(result).toEqual({ ok: true, value: [0, 1, 2], logs: [] });
  });

  it("rejects a row set over the row cap and says to aggregate", async () => {
    const { results, handle } = await storeWithRows(6);
    const result = await run(`data("${handle}")`, results);
    expect(result).toMatchObject({
      ok: false,
      error: `Error: ${handle} has 6 rows, more than the 5 a script can read. Aggregate or filter with query_sql first. (line 1)`,
    });
  });

  it("rejects an unknown handle, a text result, and a non-string argument", async () => {
    const results = new InMemoryResultStore();
    const textHandle = await results.putText("hello", { tool: "read_file", arguments: {} });
    expect(await run('data("r99")', results)).toMatchObject({
      error: "Error: No stored result is called r99. Use a handle from an earlier result. (line 1)",
    });
    expect(await run(`data("${textHandle}")`, results)).toMatchObject({
      error: `Error: ${textHandle} holds text, not rows. data() reads row sets only. (line 1)`,
    });
    expect(await run("data(12)", results)).toMatchObject({ ok: false });
  });
});

describe("save()", () => {
  it("stores rows and returns a handle that data() reads back", async () => {
    const results = new InMemoryResultStore();
    const result = await run(
      'const handle = save("totals", [{ team: "a", total: 3 }, { team: "b", total: 4 }]);\nreturn data(handle);',
      results,
    );
    expect(result).toEqual({
      ok: true,
      value: [
        { team: "a", total: 3 },
        { team: "b", total: 4 },
      ],
      logs: [],
    });
    const meta = await results.describe("r1");
    expect(meta).toMatchObject({ tool: "save", label: "totals", kind: "rows", itemCount: 2 });
  });

  it("rejects more rows than the cap", async () => {
    const results = new InMemoryResultStore();
    const result = await run('save("big", Array.from({ length: 6 }, (_, i) => ({ i })))', results);
    expect(result).toMatchObject({
      ok: false,
      error: "Error: save() accepts at most 5 rows; got 6. Aggregate before saving. (line 1)",
    });
    expect(results.handles()).toEqual([]);
  });

  it("rejects a missing name and rows that are not objects", async () => {
    const results = new InMemoryResultStore();
    expect(await run('save("", [{ a: 1 }])', results)).toMatchObject({ ok: false });
    expect(await run('save("x", [1, 2])', results)).toMatchObject({ ok: false });
    expect(await run('save("x", "rows")', results)).toMatchObject({ ok: false });
    expect(results.handles()).toEqual([]);
  });
});
