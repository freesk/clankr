// `/undo` and snapshots, in a temporary folder, with a fake Trash.

import {
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SlashCommandContext, ToolContext, ToolDefinition } from "../../contracts/index.ts";
import { createTestToolContext } from "../../testing/index.ts";
import { pathExists } from "./disk.ts";
import { createFileSlashCommands, createFileTools, type TrashFunction } from "./index.ts";
import { undoLastChange } from "./undo.ts";

let work: string;
let fakeTrash: string;
let context: ToolContext;
let cleanupContext: () => Promise<void>;
let tools: Map<string, ToolDefinition>;

const trash: TrashFunction = async (paths) => {
  for (const path of paths) {
    await rename(path, join(fakeTrash, `${Date.now()}-${Math.random()}-${basename(path)}`));
  }
};

beforeEach(async () => {
  work = await realpath(await mkdtemp(join(tmpdir(), "vix-fs-work-")));
  fakeTrash = await mkdtemp(join(tmpdir(), "vix-fs-trash-"));
  const created = await createTestToolContext({ workingDirectory: work });
  context = created.context;
  cleanupContext = created.cleanup;
  tools = new Map(createFileTools({ trash }).map((tool) => [tool.name, tool]));
  await writeFile(join(work, "notes.md"), "one\ntwo\n");
});

afterEach(async () => {
  await cleanupContext();
  await rm(work, { recursive: true, force: true });
  await rm(fakeTrash, { recursive: true, force: true });
});

function run(name: string, args: Record<string, unknown>) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.run(tool.parameters.parse(args), context);
}

const undo = () => undoLastChange({ trash, snapshotsDirectory: snapshots() });
const snapshots = () => context.vixPaths.session.snapshots;
const inWork = (path: string) => join(work, path);
const read = (path: string) => readFile(inWork(path), "utf8");

async function markRead(path: string): Promise<void> {
  const stats = await stat(inWork(path));
  context.readTracker.markRead(inWork(path), {
    modifiedTimeMs: stats.mtimeMs,
    sizeBytes: stats.size,
  });
}

describe("/undo", () => {
  it("reverses an edit, and a second undo has nothing left", async () => {
    await run("edit_file", { path: "notes.md", old: "two", new: "2" });
    expect(await undo()).toBe('Undid "Edit notes.md: replaced 1 occurrence at line 2".');
    expect(await read("notes.md")).toBe("one\ntwo\n");
    expect(await undo()).toBe("Nothing to undo.");
  });

  it("reverses an overwrite", async () => {
    await markRead("notes.md");
    await run("write_file", { path: "notes.md", content: "replaced\n" });
    await undo();
    expect(await read("notes.md")).toBe("one\ntwo\n");
  });

  it("reverses a new file by trashing it and removing the folders it created", async () => {
    await run("write_file", { path: "new/deep/file.txt", content: "x" });
    await undo();
    expect(await pathExists(inWork("new"))).toBe(false);
    expect(await readdir(fakeTrash)).toHaveLength(1);
  });

  it("reverses a multi-source move into a new folder", async () => {
    await writeFile(inWork("b.md"), "b");
    await run("move", { sources: ["notes.md", "b.md"], destination: "archive" });
    await undo();
    expect(await read("notes.md")).toBe("one\ntwo\n");
    expect(await read("b.md")).toBe("b");
    expect(await pathExists(inWork("archive"))).toBe(false);
  });

  it("reverses a copy, a make_dir, and a delete", async () => {
    await run("copy", { sources: ["notes.md"], destination: "copy.md" });
    await undo();
    expect(await pathExists(inWork("copy.md"))).toBe(false);

    await run("make_dir", { path: "x/y" });
    await undo();
    expect(await pathExists(inWork("x"))).toBe(false);

    await run("delete", { path: "notes.md" });
    expect(await pathExists(inWork("notes.md"))).toBe(false);
    await undo();
    expect(await read("notes.md")).toBe("one\ntwo\n");
  });

  it("refuses when the file changed outside vix, and changes nothing", async () => {
    await run("edit_file", { path: "notes.md", old: "two", new: "2" });
    await writeFile(inWork("notes.md"), "edited by hand, much longer\n");
    expect(await undo()).toMatch(/Cannot undo .*notes\.md changed after the change was made/);
    expect(await read("notes.md")).toBe("edited by hand, much longer\n");
  });

  it("refuses to move back onto a path that is taken again", async () => {
    await run("move", { sources: ["notes.md"], destination: "moved.md" });
    await writeFile(inWork("notes.md"), "new one");
    expect(await undo()).toMatch(/notes\.md exists again/);
    expect(await read("moved.md")).toBe("one\ntwo\n");
  });

  it("keeps only the newest snapshot on disk", async () => {
    await run("edit_file", { path: "notes.md", old: "one", new: "1" });
    await run("edit_file", { path: "notes.md", old: "two", new: "2" });
    const remaining = await readdir(snapshots());
    expect(remaining).toHaveLength(1);
    const manifest = JSON.parse(
      await readFile(join(snapshots(), remaining[0] ?? "", "manifest.json"), "utf8"),
    );
    expect(manifest.description).toBe("Edit notes.md: replaced 1 occurrence at line 2");
    await undo();
    expect(await read("notes.md")).toBe("1\ntwo\n");
    expect(await undo()).toBe("Nothing to undo.");
  });

  it("keeps the previous snapshot when a change is refused or changes nothing", async () => {
    await run("edit_file", { path: "notes.md", old: "one", new: "1" });
    await expect(run("edit_file", { path: "notes.md", old: "zzz", new: "y" })).rejects.toThrow();
    await run("make_dir", { path: "." });
    expect(await readdir(snapshots())).toHaveLength(1);
    await undo();
    expect(await read("notes.md")).toBe("one\ntwo\n");
  });

  it("is registered as a slash command that prints its result", async () => {
    const [command] = createFileSlashCommands(context.vixPaths, { trash });
    const printed: string[] = [];
    const commandContext: SlashCommandContext = {
      session: {
        id: "test-session",
        messages: [],
        model: undefined,
        permissionMode: "ask",
        grants: { tools: new Set(), dataFiles: new Set() },
        reasoning: "on",
        ephemeral: true,
      },
      config: context.config,
      lm: context.lm,
      print: (text) => printed.push(text),
    };
    expect(command?.name).toBe("undo");
    await command?.run("", commandContext);
    expect(printed).toEqual(["Nothing to undo."]);
  });
});
