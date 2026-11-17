import { readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readIndexCatalog } from "./index-catalog.ts";
import { indexFileFor } from "./index-location.ts";
import { IndexStore } from "./index-store.ts";
import { createIndexWorkspace, type IndexWorkspace } from "./test-support.ts";

let workspace: IndexWorkspace;

afterEach(async () => {
  await workspace?.cleanup();
});

/** Paths the index holds passages for. */
async function indexedPaths(): Promise<string[]> {
  const store = await IndexStore.open(
    indexFileFor(workspace.indexDirectory, workspace.documents),
    "read",
  );
  try {
    const files = await store.listFiles();
    return files.filter((file) => file.chunkCount > 0).map((file) => file.path);
  } finally {
    await store.close();
  }
}

/** Texts sent for embedding since the count was last taken, without the size probe. */
function embeddedTexts(fromRequest = 0): string[] {
  return workspace.lm.embeddingRequests
    .slice(fromRequest)
    .flatMap((request) => request.inputs)
    .filter((input) => input !== "search_document: clankr");
}

describe("building an index", () => {
  it("indexes text files and reports what it did", async () => {
    workspace = await createIndexWorkspace();
    await workspace.write("notes/lease.md", "Either party may end the lease early.\n");
    await workspace.write("todo.txt", "Buy milk.\n");

    expect(await workspace.index()).toBe("done");

    expect(await indexedPaths()).toEqual(["notes/lease.md", "todo.txt"]);
    const summary = workspace.printed.join("\n");
    expect(summary).toMatch(/2 files read \(2 passages\), 0 unchanged, 0 removed/);
    expect(summary).toMatch(/The index now holds 2 files and 2 passages/);
    expect(workspace.progress.at(-1)).toMatchObject({ filesDone: 2, filesTotal: 2 });
  });

  it("sends passages with the document prefix, in batches of the configured size", async () => {
    workspace = await createIndexWorkspace({ config: { search: { embeddingBatchSize: 2 } } });
    for (const name of ["a", "b", "c", "d", "e"]) await workspace.write(`${name}.txt`, `${name}\n`);

    await workspace.index();

    const batches = workspace.lm.embeddingRequests.slice(1);
    expect(batches.map((request) => request.inputs.length)).toEqual([2, 2, 1]);
    expect(
      batches.every((request) => request.model === workspace.config.search.embeddingModel),
    ).toBe(true);
    expect(embeddedTexts()).toEqual(
      ["a", "b", "c", "d", "e"].map((name) => `search_document: ${name}`),
    );
  });

  it("embeds only new and changed files on a second run", async () => {
    workspace = await createIndexWorkspace();
    await workspace.write("kept.txt", "This file stays the same.\n");
    const changing = await workspace.write("changing.txt", "First version.\n");
    await workspace.index();

    const requestsBefore = workspace.lm.embeddingRequests.length;
    await writeFile(changing, "Second version, now longer.\n");
    await workspace.write("added.txt", "A new file.\n");
    await workspace.index();

    expect(embeddedTexts(requestsBefore)).toEqual([
      "search_document: A new file.",
      "search_document: Second version, now longer.",
    ]);
    expect(workspace.printed.at(-1)).toMatch(/2 files read \(2 passages\), 1 unchanged, 0 removed/);
    expect(await indexedPaths()).toEqual(["added.txt", "changing.txt", "kept.txt"]);
  });

  it("re-reads a file whose size is the same but whose modified time changed", async () => {
    workspace = await createIndexWorkspace();
    const path = await workspace.write("note.txt", "aaaa\n");
    await workspace.index();

    const requestsBefore = workspace.lm.embeddingRequests.length;
    await writeFile(path, "bbbb\n");
    await utimes(path, new Date(), new Date(Date.now() + 5_000));
    await workspace.index();

    expect(embeddedTexts(requestsBefore)).toEqual(["search_document: bbbb"]);
  });

  it("drops files that are gone", async () => {
    workspace = await createIndexWorkspace();
    await workspace.write("kept.txt", "Stays.\n");
    const doomed = await workspace.write("doomed.txt", "Will be deleted.\n");
    await workspace.index();

    await rm(doomed);
    await workspace.index();

    expect(await indexedPaths()).toEqual(["kept.txt"]);
    expect(workspace.printed.at(-1)).toMatch(/0 files read \(0 passages\), 1 unchanged, 1 removed/);
    expect(workspace.printed.at(-1)).toMatch(/now holds 1 file and 1 passage/);
  });

  it("leaves out protected files, excluded folders, spreadsheets, binaries, and oversized files", async () => {
    workspace = await createIndexWorkspace({
      deniedPaths: ["secrets"],
      config: { search: { indexMaxTextFileBytes: 100 } },
    });
    await workspace.write("plain.md", "Indexed.\n");
    await workspace.write("secrets/key.txt", "Never read.\n");
    await workspace.write("node_modules/pkg/readme.md", "Excluded by default.\n");
    await workspace.write("table.csv", "a,b\n1,2\n");
    await workspace.write("photo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]));
    await workspace.write("blob.dat", new Uint8Array([1, 2, 0, 0, 3, 0]));
    await workspace.write("huge.txt", "x".repeat(500));

    await workspace.index();

    expect(await indexedPaths()).toEqual(["plain.md"]);
    expect(embeddedTexts()).toEqual(["search_document: Indexed."]);
    const summary = workspace.printed.join("\n");
    expect(summary).toMatch(/Skipped: 1 not text, 1 protected, 1 too large\./);
  });

  it("refuses a protected folder, a missing folder, and a file", async () => {
    workspace = await createIndexWorkspace({ deniedPaths: ["secrets"] });
    const file = await workspace.write("secrets/key.txt", "Never read.\n");

    const build = (folder: string) => workspace.run({ action: "build", folder, rebuild: false });
    expect(await build(join(workspace.documents, "secrets"))).toBe("failed");
    expect(await build(join(workspace.documents, "nowhere"))).toBe("failed");
    expect(await build(await workspace.write("a.txt", "text\n"))).toBe("failed");

    expect(workspace.printed).toEqual([
      expect.stringMatching(/secrets is protected and cannot be indexed/),
      expect.stringMatching(/nowhere does not exist/),
      expect.stringMatching(/a\.txt is a file/),
    ]);
    expect(file).toContain("secrets");
    expect(await readdir(workspace.indexDirectory).catch(() => [])).toEqual([]);
  });

  it("refuses an index built with another embedding model, and rebuilds on request", async () => {
    workspace = await createIndexWorkspace();
    await workspace.write("note.txt", "Some text.\n");
    await workspace.index();

    const otherModel = {
      ...workspace.config,
      search: { ...workspace.config.search, embeddingModel: "other/embedder" },
    };
    expect(await workspace.index({ config: otherModel })).toBe("failed");
    expect(workspace.printed.at(-1)).toMatch(
      /built with the embedding model "text-embedding-nomic-embed-text-v1\.5", but search\.embeddingModel is now "other\/embedder"\. Rebuild it with `clankr index --rebuild /,
    );

    const rebuild = { action: "build", folder: workspace.documents, rebuild: true } as const;
    expect(await workspace.run(rebuild, { config: otherModel })).toBe("done");
    const { folders } = await readIndexCatalog(workspace.indexDirectory);
    expect(folders.map((folder) => folder.embeddingModel)).toEqual(["other/embedder"]);
  });

  it("reports a damaged index file with the way out, and rebuilds over it", async () => {
    workspace = await createIndexWorkspace();
    await workspace.write("note.txt", "Some text.\n");
    await workspace.index();
    await writeFile(indexFileFor(workspace.indexDirectory, workspace.documents), "not a database");

    expect(await workspace.index()).toBe("failed");
    expect(workspace.printed.at(-1)).toMatch(
      /cannot be read \(.+\)\. Rebuild it with `clankr index --rebuild /,
    );

    const rebuild = { action: "build", folder: workspace.documents, rebuild: true } as const;
    expect(await workspace.run(rebuild)).toBe("done");
    expect(await indexedPaths()).toEqual(["note.txt"]);
  });

  it("refuses when the model's vectors changed size under the same name", async () => {
    workspace = await createIndexWorkspace();
    await workspace.write("note.txt", "Some text.\n");
    await workspace.index();

    workspace.lm.embeddingDimensions = 32;
    expect(await workspace.index()).toBe("failed");
    expect(workspace.printed.at(-1)).toMatch(/holds 256-number vectors.*now returns 32/);
  });

  it("stops between files when cancelled, and a later run finishes the rest", async () => {
    workspace = await createIndexWorkspace({ config: { search: { embeddingBatchSize: 1 } } });
    for (const name of ["a", "b", "c", "d"]) await workspace.write(`${name}.txt`, `${name}\n`);

    const controller = new AbortController();
    const outcome = await workspace.index({
      signal: controller.signal,
      showProgress: (progress) => {
        if (progress.filesDone === 2) controller.abort();
      },
    });

    expect(outcome).toBe("cancelled");
    expect(workspace.printed.at(-1)).toMatch(/cancelled.*What was stored is kept/);
    expect(await indexedPaths()).toEqual(["a.txt", "b.txt"]);
    const [unfinished] = (await readIndexCatalog(workspace.indexDirectory)).folders;
    expect(unfinished).toMatchObject({ complete: false, fileCount: 2, passageCount: 2 });

    const requestsBefore = workspace.lm.embeddingRequests.length;
    expect(await workspace.index()).toBe("done");
    expect(embeddedTexts(requestsBefore)).toEqual(["search_document: c", "search_document: d"]);
    const [finished] = (await readIndexCatalog(workspace.indexDirectory)).folders;
    expect(finished).toMatchObject({ complete: true, fileCount: 4, passageCount: 4 });
  });

  it("keeps the index directory and its files user-only (SEC-5)", async () => {
    workspace = await createIndexWorkspace();
    await workspace.write("note.txt", "Some text.\n");
    await workspace.index();

    expect((await stat(workspace.indexDirectory)).mode & 0o777).toBe(0o700);
    const names = await readdir(workspace.indexDirectory);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect((await stat(join(workspace.indexDirectory, name))).mode & 0o777).toBe(0o600);
    }
  });

  it("creates nothing when the embedding model cannot be reached", async () => {
    workspace = await createIndexWorkspace();
    await workspace.write("note.txt", "Some text.\n");
    workspace.lm.embed = async () => {
      throw new Error("connection refused");
    };

    await expect(workspace.index()).rejects.toThrow("connection refused");
    expect(await readdir(workspace.indexDirectory).catch(() => [])).toEqual([]);
  });
});

describe("listing and removing indexes", () => {
  it("lists indexed folders with counts and age, and says when none exist", async () => {
    workspace = await createIndexWorkspace();
    await workspace.run({ action: "status" });
    expect(workspace.printed.at(-1)).toMatch(/No folder is indexed/);

    await workspace.write("note.txt", "Some text.\n");
    await workspace.index({ now: () => new Date("2026-11-10T10:00:00Z") });
    await workspace.run({ action: "status" }, { now: () => new Date("2026-11-13T10:00:00Z") });

    expect(workspace.printed.at(-1)).toMatch(
      /documents · 1 file · 1 passage · indexed 3 days ago$/,
    );
  });

  it("removes one folder's index", async () => {
    workspace = await createIndexWorkspace();
    await workspace.write("note.txt", "Some text.\n");
    await workspace.index();

    expect(await workspace.run({ action: "remove", folder: workspace.documents })).toBe("done");
    expect(await readdir(workspace.indexDirectory)).toEqual([]);
    expect(await workspace.run({ action: "remove", folder: workspace.documents })).toBe("failed");
    expect(workspace.printed.at(-1)).toMatch(/is not indexed\. Nothing is indexed\./);
  });

  it("refuses to index a folder inside or around an indexed one", async () => {
    workspace = await createIndexWorkspace();
    await workspace.write("sub/note.txt", "Some text.\n");
    const sub = join(workspace.documents, "sub");
    await workspace.run({ action: "build", folder: sub, rebuild: false });

    expect(await workspace.index()).toBe("failed");
    expect(workspace.printed.at(-1)).toMatch(/contains .*sub, which has its own index/);

    await workspace.run({ action: "remove", folder: sub });
    await workspace.index();
    expect(await workspace.run({ action: "build", folder: sub, rebuild: false })).toBe("failed");
    expect(workspace.printed.at(-1)).toMatch(/sub is inside .*documents, which is already indexed/);
  });
});
