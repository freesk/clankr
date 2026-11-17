// move, copy, and delete, in a temporary folder, with a fake Trash.

import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolContext, ToolDefinition } from "../../contracts/index.ts";
import { createTestToolContext, FixedPathPolicy } from "../../testing/index.ts";
import { pathExists } from "./disk.ts";
import { createFileTools } from "./index.ts";

let work: string;
let fakeTrash: string;
let trashed: string[];
let context: ToolContext;
let cleanupContext: () => Promise<void>;
let tools: Map<string, ToolDefinition>;

beforeEach(async () => {
  work = await realpath(await mkdtemp(join(tmpdir(), "vix-fs-work-")));
  fakeTrash = await mkdtemp(join(tmpdir(), "vix-fs-trash-"));
  trashed = [];
  const created = await createTestToolContext({
    workingDirectory: work,
    paths: new FixedPathPolicy({ allowedRoots: [work], deniedPaths: [join(work, "secrets")] }),
  });
  context = created.context;
  cleanupContext = created.cleanup;
  const fileTools = createFileTools({
    trash: async (paths) => {
      for (const path of paths) {
        trashed.push(path);
        await rename(path, join(fakeTrash, `${trashed.length}-${basename(path)}`));
      }
    },
  });
  tools = new Map(fileTools.map((tool) => [tool.name, tool]));
  await writeFile(join(work, "a.png"), "A");
  await writeFile(join(work, "b.png"), "B");
});

afterEach(async () => {
  await cleanupContext();
  await rm(work, { recursive: true, force: true });
  await rm(fakeTrash, { recursive: true, force: true });
});

function tool(name: string): ToolDefinition {
  const found = tools.get(name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
}

function run(name: string, args: Record<string, unknown>) {
  return tool(name).run(tool(name).parameters.parse(args), context);
}

async function preview(name: string, args: Record<string, unknown>) {
  const definition = tool(name);
  return definition.previewChange?.(definition.parameters.parse(args), context);
}

const inWork = (path: string) => join(work, path);
const read = (path: string) => readFile(inWork(path), "utf8");

describe("the tool definitions", () => {
  it("are six core write tools with a preview and a key argument", () => {
    expect([...tools.keys()]).toEqual([
      "write_file",
      "edit_file",
      "make_dir",
      "move",
      "copy",
      "delete",
    ]);
    for (const definition of tools.values()) {
      expect(definition.permission).toBe("write");
      expect(definition.groups).toEqual(["core"]);
      expect(definition.previewChange).toBeTypeOf("function");
      expect(definition.keyArgument).toBeTruthy();
    }
  });
});

describe("move", () => {
  it("renames a single file, as previewed", async () => {
    const args = { sources: ["a.png"], destination: "renamed.png" };
    const shown = await preview("move", args);
    expect(shown?.summary).toBe("Move a.png to renamed.png");
    expect(shown?.targetPaths).toEqual([inWork("a.png"), inWork("renamed.png")]);
    await run("move", args);
    expect(await read("renamed.png")).toBe("A");
    expect(await pathExists(inWork("a.png"))).toBe(false);
  });

  it("moves several sources into a new folder in one call", async () => {
    const args = { sources: ["a.png", "b.png"], destination: "Pictures/Screenshots" };
    const shown = await preview("move", args);
    expect(shown?.summary).toBe("Move 2 items into Pictures/Screenshots (new folder)");
    await run("move", args);
    expect((await readdir(inWork("Pictures/Screenshots"))).sort()).toEqual(["a.png", "b.png"]);
  });

  it("moves a single source into an existing folder", async () => {
    await mkdir(inWork("archive"));
    await run("move", { sources: ["a.png"], destination: "archive" });
    expect(await read("archive/a.png")).toBe("A");
  });

  it("refuses an existing target and names it", async () => {
    await expect(run("move", { sources: ["a.png"], destination: "b.png" })).rejects.toThrow(
      /b\.png already exists and will not be overwritten/,
    );
    expect(await read("b.png")).toBe("B");
  });

  it("changes nothing when one source in a list is bad", async () => {
    await expect(
      run("move", { sources: ["a.png", "missing.png", "b.png"], destination: "out" }),
    ).rejects.toThrow(/missing\.png does not exist/);
    expect(await pathExists(inWork("out"))).toBe(false);
    expect(await read("a.png")).toBe("A");
  });

  it("refuses a target that already exists in the destination folder, changing nothing", async () => {
    await mkdir(inWork("out"));
    await writeFile(inWork("out/b.png"), "old B");
    await expect(run("move", { sources: ["a.png", "b.png"], destination: "out" })).rejects.toThrow(
      /out\/b\.png already exists/,
    );
    expect(await pathExists(inWork("a.png"))).toBe(true);
    expect(await read("out/b.png")).toBe("old B");
  });

  it("refuses moving a folder inside itself, a file as a multi-source destination, and protected paths", async () => {
    await mkdir(inWork("folder"));
    await expect(run("move", { sources: ["folder"], destination: "folder/sub" })).rejects.toThrow(
      /inside itself/,
    );
    await expect(
      run("move", { sources: ["a.png", "b.png"], destination: "a.png" }),
    ).rejects.toThrow(/must be a folder/);
    await expect(run("move", { sources: ["a.png"], destination: "secrets/a.png" })).rejects.toThrow(
      /protected/,
    );
    await expect(run("move", { sources: ["secrets/key"], destination: "key" })).rejects.toThrow(
      /protected/,
    );
  });
});

describe("copy", () => {
  it("copies a folder tree and several files, as previewed", async () => {
    await mkdir(inWork("project/src"), { recursive: true });
    await writeFile(inWork("project/src/main.ts"), "main");
    await run("copy", { sources: ["project"], destination: "backup" });
    expect(await read("backup/src/main.ts")).toBe("main");
    expect(await read("project/src/main.ts")).toBe("main");

    const args = { sources: ["a.png", "b.png"], destination: "copies" };
    const shown = await preview("copy", args);
    expect(shown?.summary).toBe("Copy 2 items into copies (new folder)");
    expect(shown?.targetPaths).toEqual([
      inWork("copies"),
      inWork("copies/a.png"),
      inWork("copies/b.png"),
    ]);
    await run("copy", args);
    expect(await read("copies/b.png")).toBe("B");
    expect(await read("b.png")).toBe("B");
  });

  it("refuses an existing target and a bad source, changing nothing", async () => {
    await expect(run("copy", { sources: ["a.png"], destination: "b.png" })).rejects.toThrow(
      /b\.png already exists/,
    );
    await expect(
      run("copy", { sources: ["a.png", "nope"], destination: "copies" }),
    ).rejects.toThrow(/nope does not exist/);
    expect(await pathExists(inWork("copies"))).toBe(false);
    await expect(run("copy", { sources: ["secrets/key"], destination: "k" })).rejects.toThrow(
      /protected/,
    );
  });
});

describe("delete", () => {
  it("moves a file to the Trash, as previewed", async () => {
    const shown = await preview("delete", { path: "a.png" });
    expect(shown?.summary).toBe("Move a.png (file, 1 B) to the Trash");
    expect(shown?.targetPaths).toEqual([inWork("a.png")]);
    expect((await run("delete", { path: "a.png" })).text).toBe("Moved a.png to the Trash.");
    expect(trashed).toEqual([inWork("a.png")]);
    expect(await pathExists(inWork("a.png"))).toBe(false);
    expect(await readdir(fakeTrash)).toEqual(["1-a.png"]);
  });

  it("refuses a missing path, a protected path, and a failed trash", async () => {
    await expect(run("delete", { path: "none" })).rejects.toThrow(/does not exist/);
    await expect(run("delete", { path: "secrets/key" })).rejects.toThrow(/protected/);
    const stubborn = createFileTools({ trash: async () => {} }).find((t) => t.name === "delete");
    await expect(
      stubborn?.run(stubborn.parameters.parse({ path: "a.png" }), context),
    ).rejects.toThrow(/could not be moved to the Trash/);
    expect(await read("a.png")).toBe("A");
  });
});
