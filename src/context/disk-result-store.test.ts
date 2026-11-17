import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Row } from "../contracts/index.ts";
import { createTemporaryClankrPaths, type TemporaryClankrPaths } from "../testing/index.ts";
import { DiskResultStore, UnknownResultError } from "./disk-result-store.ts";

const provenance = { tool: "find_files", arguments: { pattern: "*.pdf" }, label: "pdfs" };

let temporary: TemporaryClankrPaths;
let directory: string;

beforeEach(async () => {
  temporary = await createTemporaryClankrPaths();
  directory = temporary.paths.session.results;
});

afterEach(async () => {
  await temporary.cleanup();
});

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const item of items) collected.push(item);
  return collected;
}

describe("DiskResultStore", () => {
  it("stores text and reads it back by line range", async () => {
    const store = new DiskResultStore(directory);
    const handle = await store.putText("a\nb\nc\nd\ne", provenance);
    expect(handle).toBe("r1");
    expect(await store.readText(handle, { startLine: 2, lineCount: 3 })).toBe("b\nc\nd");
    expect(await store.readText(handle, { startLine: 5, lineCount: 10 })).toBe("e");
    const meta = await store.describe(handle);
    expect(meta).toMatchObject({ kind: "text", itemCount: 5, tool: "find_files", label: "pdfs" });
    expect(meta.arguments).toEqual({ pattern: "*.pdf" });
  });

  it("stores row sets as JSON Lines that another reader can open directly", async () => {
    const store = new DiskResultStore(directory);
    async function* rows(): AsyncGenerator<Row> {
      yield { name: "a", amount: 1 };
      yield { name: "b", amount: 2, extra: null };
      yield { name: "c", amount: 3 };
    }
    const handle = await store.putRows(rows(), { tool: "query_sql", arguments: { sql: "x" } });
    const meta = await store.describe(handle);
    expect(meta).toMatchObject({
      kind: "rows",
      itemCount: 3,
      columns: ["name", "amount", "extra"],
    });

    const filePath = store.rowsFilePath(handle);
    expect(filePath).toBe(join(directory, `${handle}.jsonl`));
    const lines = (await readFile(filePath as string, "utf8")).trimEnd().split("\n");
    expect(lines.map((line) => JSON.parse(line))).toHaveLength(3);

    expect(await collect(store.readRows(handle, 2))).toEqual([
      { name: "a", amount: 1 },
      { name: "b", amount: 2, extra: null },
    ]);
    expect(await store.readText(handle, { startLine: 3, lineCount: 1 })).toBe(
      '{"name":"c","amount":3}',
    );
  });

  it("stores dates as ISO strings", async () => {
    const store = new DiskResultStore(directory);
    const date = new Date("2025-03-01T00:00:00.000Z");
    // A Date is not a JsonValue, but engines can hand one over at run time.
    const handle = await store.putRows([{ when: date as unknown as string }], {
      tool: "query_sql",
      arguments: {},
    });
    expect(await collect(store.readRows(handle))).toEqual([{ when: "2025-03-01T00:00:00.000Z" }]);
  });

  it("writes files only the user can read, in a directory only the user can open", async () => {
    const store = new DiskResultStore(directory);
    const handle = await store.putText("secret", provenance);
    expect((await stat(join(directory, `${handle}.txt`))).mode & 0o777).toBe(0o600);
    expect((await stat(join(directory, `${handle}.meta.json`))).mode & 0o777).toBe(0o600);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
  });

  it("continues numbering from what is on disk, so handles survive resume", async () => {
    const first = new DiskResultStore(directory);
    await first.putText("one", provenance);
    await first.putText("two", provenance);

    const resumed = new DiskResultStore(directory);
    expect(await resumed.readText("r2", { startLine: 1, lineCount: 1 })).toBe("two");
    expect(await resumed.putText("three", provenance)).toBe("r3");
  });

  it("never gives two concurrent puts the same handle", async () => {
    const store = new DiskResultStore(directory);
    const handles = await Promise.all(
      Array.from({ length: 10 }, (_, index) => store.putText(`text ${index}`, provenance)),
    );
    expect(new Set(handles).size).toBe(10);
  });

  it("rejects unknown and malformed handles, including path tricks", async () => {
    const store = new DiskResultStore(directory);
    await store.putText("x", provenance);
    await writeFile(join(temporary.paths.session.directory, "outside.meta.json"), "{}");
    for (const handle of ["r99", "../outside", "r1/../r1", "R1", ""]) {
      await expect(store.describe(handle)).rejects.toBeInstanceOf(UnknownResultError);
    }
    expect(store.rowsFilePath("../outside")).toBeUndefined();
    expect(store.rowsFilePath("r1")).toBeUndefined();
  });
});
