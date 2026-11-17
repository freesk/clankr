import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../contracts/index.ts";
import { createTestToolContext, FixedPathPolicy } from "../../testing/index.ts";
import { createFindFilesTool } from "./find-files.ts";
import { type FixtureTree, writeFixtureTree } from "./fixture-tree.ts";
import { macSpotlight, type SpotlightIndex } from "./spotlight.ts";

const unavailableIndex: SpotlightIndex = {
  coverage: async () => ({ covered: false, reason: "Spotlight index reported unavailable" }),
  query: async () => {
    throw new Error("query must not run when the index is unavailable");
  },
};

/** An index that returns every path under the root, as a superset of any real answer. */
function everythingIndex(queries: string[] = []): SpotlightIndex {
  return {
    coverage: async () => ({ covered: true }),
    async query(root, query) {
      queries.push(query);
      const names = await readdir(root, { recursive: true });
      return { paths: names.map((name) => join(root, name)), truncated: false };
    },
  };
}

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

type FindArguments = Parameters<ReturnType<typeof createFindFilesTool>["run"]>[0];

async function find(args: FindArguments, index: SpotlightIndex) {
  const tool = createFindFilesTool(index);
  return tool.run(tool.parameters.parse({ root: tree.root, ...args }), context);
}

/** The listed paths, without sizes and dates, in ranked order. */
function listedPaths(text: string): string[] {
  return text
    .split("\n")
    .slice(1)
    .filter((line) => !line.startsWith("Note:") && !line.startsWith("…") && line !== "No matches.")
    .map((line) => line.split("  ")[0] as string);
}

const filterCases: [string, FindArguments, string[]][] = [
  ["a name glob", { pattern: "*.md" }, ["notes/plan.md", "notes/old-plan.md"]],
  [
    "plain text as 'name contains'",
    { pattern: "plan" },
    ["notes/plan.md", "deep/a/b/c/plan.txt", "notes/old-plan.md"],
  ],
  ["a brace glob", { pattern: "*.{pdf,png}" }, ["photos/cat.png", "reports/q3-report.pdf"]],
  ["type pdf", { type: "pdf" }, ["reports/q3-report.pdf"]],
  ["type image", { type: "image" }, ["photos/cat.png"]],
  ["type spreadsheet", { type: "spreadsheet" }, ["reports/sales.csv"]],
  ["a minimum size", { min_size: "100KB" }, ["reports/sales.csv"]],
  ["a maximum size", { max_size: "20 B", type: "file" }, ["photos/cat.png", "deep/a/b/c/plan.txt"]],
  [
    "modified after",
    { modified_after: "3d", type: "file" },
    ["notes/plan.md", "long.txt", "deep/a/b/c/plan.txt"],
  ],
  ["modified before", { modified_before: "365 days ago" }, ["notes/old-plan.md"]],
  // macOS moves the creation date back when a test sets an earlier modified date,
  // so creation dates here follow the fixture ages.
  [
    "created after",
    { created_after: "3d", type: "file" },
    ["notes/plan.md", "long.txt", "deep/a/b/c/plan.txt"],
  ],
  ["created before", { created_before: "2000-01-01" }, []],
  [
    "name and date combined",
    { pattern: "*plan*", modified_after: "30d" },
    ["notes/plan.md", "deep/a/b/c/plan.txt"],
  ],
  [
    "type and size combined",
    { type: "document", min_size: "1KB" },
    ["long.txt", "reports/q3-report.pdf"],
  ],
];

describe("find_files filters", () => {
  for (const [label, args, expected] of filterCases) {
    it(`${label}: the walk and Spotlight return the same files`, async () => {
      const walked = await find(args, unavailableIndex);
      const indexed = await find(args, everythingIndex());
      expect(listedPaths(walked.text).sort()).toEqual([...expected].sort());
      expect(listedPaths(indexed.text).sort()).toEqual([...expected].sort());
    });
  }

  it("lists folders with a trailing slash", async () => {
    const output = await find({ type: "folder", pattern: "notes" }, unavailableIndex);
    expect(listedPaths(output.text)).toEqual(["notes/"]);
  });

  it("refuses a date it cannot parse, with an example", async () => {
    await expect(find({ modified_after: "last spring" }, unavailableIndex)).rejects.toThrow(/7d/);
  });
});

describe("find_files backends", () => {
  it("says when it fell back to a folder walk", async () => {
    const output = await find({ pattern: "*.md" }, unavailableIndex);
    expect(output.text).toContain("via folder walk");
    expect(output.text).toContain(
      "Spotlight index reported unavailable, so this searched by walking",
    );
  });

  it("builds one metadata query from the flat arguments", async () => {
    const queries: string[] = [];
    await find(
      { pattern: "*.md", min_size: "1KB", modified_after: "2025-01-01" },
      everythingIndex(queries),
    );
    expect(queries[0]).toMatch(
      /^kMDItemFSName == '\*\.md'cd && kMDItemFSSize >= 1024 && kMDItemFSContentChangeDate >= \$time\.iso\(2025-/,
    );
  });

  it.skipIf(!existsSync("/System/Applications/Calculator.app"))(
    "finds an app through the real Spotlight index",
    async () => {
      const tool = createFindFilesTool(macSpotlight);
      const args = tool.parameters.parse({
        pattern: "Calculator.app",
        root: "/System/Applications",
      });
      const output = await tool.run(args, {
        ...context,
        paths: new FixedPathPolicy({ allowedRoots: ["/"] }),
      });
      expect(output.text).toContain("via Spotlight");
      expect(listedPaths(output.text)).toContain("Calculator.app/");
    },
  );
});

describe("find_files excludes, denied paths, ranking, and the cap", () => {
  it("skips default excludes unless told not to", async () => {
    expect(listedPaths((await find({ pattern: "index.js" }, unavailableIndex)).text)).toEqual([]);
    const everything = await find(
      { pattern: "index.js", default_excludes: false },
      unavailableIndex,
    );
    expect(listedPaths(everything.text)).toEqual(["node_modules/pkg/index.js"]);
  });

  it("applies extra excludes from the call", async () => {
    const output = await find({ pattern: "*.md", exclude: ["notes"] }, everythingIndex());
    expect(listedPaths(output.text)).toEqual([]);
  });

  it("never returns a denied path, from either backend", async () => {
    for (const index of [unavailableIndex, everythingIndex()]) {
      const output = await find({ pattern: "keys" }, index);
      expect(output.text).not.toContain("keys.txt");
    }
  });

  it("refuses a denied root", async () => {
    await expect(find({ root: tree.deniedFolder }, unavailableIndex)).rejects.toThrow(/protected/);
  });

  it("ranks a recent, shallow, exact match first", async () => {
    const output = await find({ pattern: "*plan*" }, unavailableIndex);
    expect(listedPaths(output.text)[0]).toBe("notes/plan.md");
  });

  it("caps the list and stores the full ranked set behind a handle", async () => {
    const capped = { ...context, config: structuredClone(context.config) };
    capped.config.search.maxHits = 2;
    const tool = createFindFilesTool(unavailableIndex);
    const output = await tool.run(tool.parameters.parse({ root: tree.root, type: "file" }), capped);
    expect(listedPaths(output.text)).toHaveLength(2);
    expect(output.handles).toHaveLength(1);
    const handle = output.handles?.[0] as string;
    expect(output.text).toContain(`result ${handle}`);
    const stored = await context.results.readText(handle, { startLine: 1, lineCount: 100 });
    expect(listedPaths(stored).length).toBeGreaterThan(2);
  });
});
