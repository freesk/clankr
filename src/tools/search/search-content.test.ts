import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../contracts/index.ts";
import { createTestToolContext, FixedPathPolicy } from "../../testing/index.ts";
import { type FixtureTree, writeFixtureTree } from "./fixture-tree.test-support.ts";
import { ripgrepBinaryPath } from "./ripgrep.ts";
import { searchContentTool } from "./search-content.ts";

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

type SearchArguments = Parameters<typeof searchContentTool.run>[0];

function search(args: Partial<SearchArguments>, toolContext = context) {
  return searchContentTool.run(searchContentTool.parameters.parse(args), toolContext);
}

/** File headings in ranked order, without the count and date. */
function listedFiles(text: string): string[] {
  return text
    .split("\n")
    .slice(1)
    .filter((line) => /^\S.* \(\d+\+?\) \d{4}-\d{2}-\d{2}$/.test(line))
    .map((line) => line.replace(/ \(.*$/, ""));
}

describe.skipIf(!existsSync(ripgrepBinaryPath))("search_content", () => {
  it("finds a literal match with line numbers, ranked", async () => {
    const output = await search({ pattern: "TODO: ship", literal: true });
    expect(listedFiles(output.text)).toEqual([
      "notes/plan.md",
      "deep/a/b/c/plan.txt",
      "notes/old-plan.md",
    ]);
    expect(output.text).toContain("  3: TODO: ship search");
  });

  it("finds a regex match", async () => {
    const output = await search({ pattern: "^alpha\\s+be+ta$" });
    expect(listedFiles(output.text)).toEqual(["notes/plan.md"]);
    expect(output.text).toContain("  2: alpha beta");
  });

  it("treats regex characters literally when asked", async () => {
    expect(listedFiles((await search({ pattern: "a.pha", literal: true })).text)).toEqual([]);
    expect(listedFiles((await search({ pattern: "a.pha" })).text)).toEqual(["notes/plan.md"]);
  });

  it("respects the default excludes and the override", async () => {
    const defaults = listedFiles((await search({ pattern: "ship search" })).text);
    expect(defaults).not.toContain("node_modules/pkg/index.js");
    expect(defaults).not.toContain(".git/config");
    const everything = listedFiles(
      (await search({ pattern: "ship search", default_excludes: false })).text,
    );
    expect(everything).toContain("node_modules/pkg/index.js");
    expect(everything).toContain(".git/config");
  });

  it("never returns a denied path", async () => {
    const output = await search({ pattern: "ship search", default_excludes: false });
    expect(output.text).not.toContain("keys.txt");
  });

  it("limits the search to a file pattern", async () => {
    const output = await search({ pattern: "ship search", file_pattern: "*.txt" });
    expect(listedFiles(output.text)).toEqual(["deep/a/b/c/plan.txt"]);
  });

  it("cuts a very long line with a marker", async () => {
    const output = await search({ pattern: "needle" });
    expect(listedFiles(output.text)).toEqual(["minified.js"]);
    const matchLine = output.text.split("\n").find((line) => line.startsWith("  1: "));
    expect(matchLine?.length).toBeLessThan(500);
  });

  it("explains an invalid regex", async () => {
    await expect(search({ pattern: "(unclosed" })).rejects.toThrow(/literal: true/);
  });

  it("says when nothing matched", async () => {
    expect((await search({ pattern: "zzz-not-there" })).text).toContain("No matches.");
  });

  it("caps the files listed and stores the rest behind a handle", async () => {
    const capped = { ...context, config: structuredClone(context.config) };
    capped.config.search.maxHits = 1;
    const output = await search({ pattern: "ship search" }, capped);
    expect(listedFiles(output.text)).toHaveLength(1);
    expect(output.handles).toHaveLength(1);
  });
});
