// Tests for the two non-search tools: list_dir and read_file.

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../contracts/index.ts";
import { createTestToolContext, FixedPathPolicy } from "../../testing/index.ts";
import { type FixtureTree, writeFixtureTree } from "./fixture-tree.test-support.ts";
import { listDirTool } from "./list-dir.ts";
import { readFileTool } from "./read-file.ts";

let tree: FixtureTree;
let context: ToolContext;
let cleanupContext: () => Promise<void>;

beforeAll(async () => {
  tree = await writeFixtureTree();
  const paths = new FixedPathPolicy({
    allowedRoots: [tree.root],
    deniedPaths: [tree.deniedFolder],
  });
  const test = await createTestToolContext({ workingDirectory: tree.root, paths });
  context = test.context;
  cleanupContext = test.cleanup;
});

afterAll(async () => {
  await cleanupContext();
  await tree.cleanup();
});

function listDir(args: Record<string, unknown>) {
  return listDirTool.run(listDirTool.parameters.parse(args), context);
}

function readFile(args: Record<string, unknown>) {
  return readFileTool.run(readFileTool.parameters.parse(args), context);
}

describe("list_dir", () => {
  it("lists folders first with sizes and dates, and hides denied entries", async () => {
    const lines = (await listDir({})).text.split("\n");
    const names = lines.slice(1).map((line) => line.split("  ")[0]);
    expect(names.slice(0, 7)).toEqual([
      ".git/",
      "deep/",
      "node_modules/",
      "notes/",
      "photos/",
      "reports/",
      "long.txt",
    ]);
    expect(lines.join("\n")).not.toContain("secret");
    expect(lines.join("\n")).toContain("1 protected entry not shown.");
    expect(lines.find((line) => line.startsWith("long.txt"))).toMatch(
      /^long\.txt {2}\d+(\.\d)? KB {2}\d{4}-\d{2}-\d{2}$/,
    );
  });

  it("shows a depth-limited tree and does not open excluded folders", async () => {
    const text = (await listDir({ depth: 3 })).text;
    expect(text).toContain("\n  plan.md  ");
    expect(text).toContain("\n  a/  ");
    expect(text).toContain("\n    b/  ");
    // Matched as a tree entry: the header line holds a random temp folder name.
    expect(text).not.toMatch(/^\s+c\/ /m);
    expect(text).toContain("node_modules/  ");
    expect(text).toMatch(/node_modules\/ {2}\S+ {2}\(skipped\)/);
    expect(text).not.toContain("pkg/");
  });

  it("refuses a file and a denied folder", async () => {
    await expect(listDir({ path: "long.txt" })).rejects.toThrow(/is a file/);
    await expect(listDir({ path: "secret" })).rejects.toThrow(/protected/);
  });

  it("stores a long listing behind a handle", async () => {
    const capped = { ...context, config: structuredClone(context.config) };
    capped.config.search.maxListEntries = 3;
    const output = await listDirTool.run(listDirTool.parameters.parse({}), capped);
    expect(output.handles).toHaveLength(1);
    expect(output.text).toContain("more. Full ranked list");
  });
});

describe("read_file", () => {
  it("returns the requested range with line numbers", async () => {
    const text = (await readFile({ path: "long.txt", start_line: 98, line_count: 3 })).text;
    expect(text.split("\n")).toEqual([
      expect.stringMatching(/^long\.txt · lines 98-100 of 500 · /),
      " 98\tline 98",
      " 99\tline 99",
      "100\tline 100",
    ]);
  });

  it("defaults to the first lines from config", async () => {
    const text = (await readFile({ path: "long.txt" })).text;
    expect(text.split("\n")[0]).toMatch(/lines 1-200 of 500/);
  });

  it("cuts a very long line with a marker", async () => {
    const text = (await readFile({ path: "minified.js" })).text;
    expect(text).toMatch(/… \[line cut, 10,014 chars\]$/);
  });

  it("refuses binary files with a pointer to the right tool", async () => {
    await expect(readFile({ path: "photos/cat.png" })).rejects.toThrow(/view_image/);
    await expect(readFile({ path: "reports/q3-report.pdf" })).rejects.toThrow(/PDF/);
  });

  it("refuses a folder, a denied file, a missing file, and a range past the end", async () => {
    await expect(readFile({ path: "notes" })).rejects.toThrow(/list_dir/);
    await expect(readFile({ path: "secret/keys.txt" })).rejects.toThrow(/protected/);
    await expect(readFile({ path: "nope.txt" })).rejects.toThrow(/does not exist/);
    await expect(readFile({ path: "long.txt", start_line: 900 })).rejects.toThrow(/past the end/);
  });

  it("records each successful read in the read tracker (FS-1)", async () => {
    const path = join(tree.root, "notes/plan.md");
    await readFile({ path: "notes/plan.md" });
    const stats = await stat(path);
    expect(context.readTracker.readState(path)).toEqual({
      modifiedTimeMs: stats.mtimeMs,
      sizeBytes: stats.size,
    });
    await expect(readFile({ path: "photos/cat.png" })).rejects.toThrow();
    expect(context.readTracker.readState(join(tree.root, "photos/cat.png"))).toBeUndefined();
  });
});
