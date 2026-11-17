import { appendFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.ts";
import { ToolError, type ToolOutput } from "../contracts/index.ts";
import { FixedPathPolicy } from "../testing/index.ts";
import { indexFileFor } from "./index-location.ts";
import { createSearchMeaningTool } from "./search-meaning-tool.ts";
import {
  createIndexWorkspace,
  holdIndexFromAnotherProcess,
  type IndexWorkspace,
} from "./test-support.ts";

let workspace: IndexWorkspace;

afterEach(async () => {
  await workspace?.cleanup();
});

function search(
  args: { query: string; root?: string },
  context = workspace.toolContext(),
): Promise<ToolOutput> {
  return createSearchMeaningTool(workspace.config).run(args, context);
}

/** The heading line of each hit: path, location, score. */
function hitHeadings(output: ToolOutput): string[] {
  return output.text.split("\n").filter((line) => /\(\d\.\d\d\)/.test(line));
}

async function indexedContracts(): Promise<void> {
  await workspace.write(
    "contracts/lease.md",
    "# Lease\n\nEither party may terminate the agreement early with ninety days notice.\n",
  );
  await workspace.write("contracts/invoice.md", "Invoice for consulting hours in March.\n");
  await workspace.write("recipes/soup.txt", "Chop the onions and simmer the broth slowly.\n");
  await workspace.index();
}

describe("search_meaning", () => {
  it("follows the tool contract", () => {
    const config = defaultConfig();
    config.context.defaultResultTokenCap = 640;
    const tool = createSearchMeaningTool(config);
    expect(tool.permission).toBe("read");
    expect(tool.groups).toEqual(["semantic"]);
    expect(tool.resultTokenCap).toBe(640);
    expect(tool.description.match(/\.(\s|$)/g)?.length).toBeLessThanOrEqual(2);
    expect(Object.keys(tool.parameters.shape)).toEqual(["query", "root"]);
  });

  it("ranks the passage closest in meaning first and states the index age", async () => {
    workspace = await createIndexWorkspace();
    await indexedContracts();

    const output = await search({ query: "terminate the agreement early" });

    const [header, ...rest] = output.text.split("\n");
    expect(header).toMatch(/^root .*documents · 3 passages, best first · indexed just now$/);
    expect(hitHeadings(output)[0]).toMatch(/^contracts\/lease\.md:1-3 \(0\.\d\d\)$/);
    expect(rest[1]).toBe(
      "  # Lease Either party may terminate the agreement early with ninety days notice.",
    );
    expect(workspace.lm.embeddingRequests.at(-1)?.inputs).toEqual([
      "search_query: terminate the agreement early",
    ]);
  });

  it("shows only the configured number of passages and keeps the full list behind a handle", async () => {
    workspace = await createIndexWorkspace({ config: { search: { meaningMaxHits: 2 } } });
    for (let index = 0; index < 6; index++) {
      await workspace.write(`note-${index}.txt`, `Note ${index} about the garden fence.\n`);
    }
    await workspace.index();

    const context = workspace.toolContext();
    const output = await search({ query: "garden fence" }, context);

    expect(hitHeadings(output)).toHaveLength(2);
    expect(output.text).toMatch(/… 4 more\. Full ranked list: result \w+/);
    const [handle] = output.handles ?? [];
    expect(handle).toBeDefined();
    const stored = await context.results.readText(handle as string, {
      startLine: 1,
      lineCount: 50,
    });
    expect(stored.split("\n").filter((line) => /\(\d\.\d\d\)/.test(line))).toHaveLength(6);
  });

  it("shows at most three passages from one file", async () => {
    workspace = await createIndexWorkspace({
      config: { search: { indexChunkCharacters: 200, indexChunkOverlap: 0 } },
    });
    const paragraph = `${"The harbour wall needs repair before winter. ".repeat(4)}\n\n`;
    await workspace.write("long.md", paragraph.repeat(8));
    await workspace.write("short.md", "Harbour notes.\n");
    await workspace.index();

    const headings = hitHeadings(await search({ query: "harbour wall repair" }));
    expect(headings.filter((line) => line.startsWith("long.md"))).toHaveLength(3);
    expect(headings.filter((line) => line.startsWith("short.md"))).toHaveLength(1);
  });

  it("limits the search to a folder or file inside an indexed folder", async () => {
    workspace = await createIndexWorkspace();
    await indexedContracts();

    const inFolder = await search({ query: "onions", root: "contracts" });
    expect(inFolder.text.split("\n")[0]).toMatch(/^root .*documents\/contracts · 2 passages/);
    expect(hitHeadings(inFolder).every((line) => line.startsWith("contracts/"))).toBe(true);

    const inFile = await search({ query: "onions", root: "recipes/soup.txt" });
    expect(hitHeadings(inFile)).toEqual([expect.stringMatching(/^recipes\/soup\.txt:1 /)]);
  });

  it("tells the model what to do when a folder is not indexed", async () => {
    workspace = await createIndexWorkspace();
    await workspace.write("contracts/lease.md", "Lease text.\n");
    await workspace.write("other/readme.md", "Other text.\n");
    await workspace.run({
      action: "build",
      folder: join(workspace.documents, "contracts"),
      rebuild: false,
    });

    const failure = await search({ query: "anything", root: "other" }).catch((error) => error);
    expect(failure).toBeInstanceOf(ToolError);
    expect(failure.message).toMatch(
      /^other is not indexed\. Indexed folders: .*contracts\. Search one of them, or tell the user to run \/index other\. Use search_content/,
    );
  });

  it("says so when nothing is indexed, without asking LM Studio", async () => {
    workspace = await createIndexWorkspace();
    await mkdir(workspace.indexDirectory, { recursive: true });

    await expect(search({ query: "anything" })).rejects.toThrow(/No folder is indexed/);
    expect(workspace.lm.embeddingRequests).toEqual([]);
  });

  it("refuses an index built with another embedding model and names the rebuild", async () => {
    workspace = await createIndexWorkspace();
    await indexedContracts();
    const requestsBefore = workspace.lm.embeddingRequests.length;
    const config = {
      ...workspace.config,
      search: { ...workspace.config.search, embeddingModel: "other/embedder" },
    };

    const failure = await search({ query: "lease" }, workspace.toolContext({ config })).catch(
      (error) => error,
    );

    expect(failure).toBeInstanceOf(ToolError);
    expect(failure.message).toMatch(/built with the embedding model "text-embedding-nomic/);
    expect(failure.message).toMatch(/\/index --rebuild .*Only the user can do that/);
    expect(workspace.lm.embeddingRequests).toHaveLength(requestsBefore);
  });

  it("does not show a file that was protected after it was indexed", async () => {
    workspace = await createIndexWorkspace();
    await indexedContracts();
    const paths = new FixedPathPolicy({
      allowedRoots: [workspace.documents],
      deniedPaths: [join(workspace.documents, "contracts")],
      workingDirectory: workspace.documents,
    });

    const output = await search(
      { query: "terminate the agreement" },
      workspace.toolContext({ paths }),
    );

    expect(hitHeadings(output)).toEqual([expect.stringMatching(/^recipes\/soup\.txt/)]);
    expect(output.text).not.toMatch(/lease|invoice/i);
  });

  it("marks passages whose file changed since indexing and leaves out deleted files", async () => {
    workspace = await createIndexWorkspace();
    await indexedContracts();
    await appendFile(join(workspace.documents, "contracts/lease.md"), "An added clause.\n");
    await rm(join(workspace.documents, "contracts/invoice.md"));

    const output = await search({ query: "terminate the agreement early" });

    expect(hitHeadings(output)[0]).toMatch(/^contracts\/lease\.md:1-3 \(0\.\d\d\) \[changed\]$/);
    expect(output.text).not.toMatch(/invoice/);
    expect(output.text).toMatch(/Note: \[changed\] files were edited after indexing/);
    expect(output.text).toMatch(/Note: left out 1 passage from files that no longer exist/);
  });

  it("says so, as does `clankr index`, while another process holds the index", async () => {
    workspace = await createIndexWorkspace();
    await indexedContracts();
    const release = await holdIndexFromAnotherProcess(
      indexFileFor(workspace.indexDirectory, workspace.documents),
    );
    try {
      const failure = await search({ query: "lease" }).catch((error) => error);
      expect(failure).toBeInstanceOf(ToolError);
      expect(failure.message).toBe(
        "The search index cannot be read right now: another clankr process is updating it; try again shortly. Use search_content for exact words meanwhile.",
      );
      expect(await workspace.index()).toBe("failed");
      expect(workspace.printed.at(-1)).toMatch(/is in use by another clankr process/);
    } finally {
      await release();
    }
    expect(hitHeadings(await search({ query: "lease" })).length).toBeGreaterThan(0);
  });

  it("reports an unfinished index", async () => {
    workspace = await createIndexWorkspace({ config: { search: { embeddingBatchSize: 1 } } });
    await workspace.write("a.txt", "First note.\n");
    await workspace.write("b.txt", "Second note.\n");
    const controller = new AbortController();
    await workspace.index({ signal: controller.signal, showProgress: () => controller.abort() });

    const output = await search({ query: "note" });

    expect(hitHeadings(output)).toHaveLength(1);
    expect(output.text).toMatch(/Note: indexing of .*documents did not finish/);
  });

  it("turns an LM Studio failure into a short error with its fix", async () => {
    workspace = await createIndexWorkspace();
    await indexedContracts();
    const { LmStudioError } = await import("../lmstudio/index.ts");
    workspace.lm.embed = async () => {
      throw new LmStudioError("server-unreachable", "LM Studio is not reachable.", "Start it.");
    };

    const failure = await search({ query: "lease" }).catch((error) => error);

    expect(failure).toBeInstanceOf(ToolError);
    expect(failure.message).toBe(
      "LM Studio is not reachable. Fix: Start it. Use search_content for exact words meanwhile.",
    );
  });
});
