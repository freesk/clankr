// write_file, edit_file, and make_dir, in a temporary folder.

import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPatch } from "diff";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolContext, ToolDefinition } from "../../contracts/index.ts";
import { createTestToolContext, FixedPathPolicy } from "../../testing/index.ts";
import { editFileTool } from "./edit-file.ts";
import { makeDirTool } from "./make-dir.ts";
import { writeFileTool } from "./write-file.ts";

let work: string;
let context: ToolContext;
let cleanupContext: () => Promise<void>;

beforeEach(async () => {
  work = await realpath(await mkdtemp(join(tmpdir(), "clankr-fs-work-")));
  const created = await createTestToolContext({
    workingDirectory: work,
    paths: new FixedPathPolicy({ allowedRoots: [work], deniedPaths: [join(work, "secrets")] }),
  });
  context = created.context;
  cleanupContext = created.cleanup;
});

afterEach(async () => {
  await cleanupContext();
  await rm(work, { recursive: true, force: true });
});

function run(tool: ToolDefinition, args: Record<string, unknown>) {
  return tool.run(tool.parameters.parse(args), context);
}

function preview(tool: ToolDefinition, args: Record<string, unknown>) {
  const previewChange = tool.previewChange;
  if (!previewChange) throw new Error(`${tool.name} has no preview`);
  return previewChange(tool.parameters.parse(args), context);
}

async function markRead(path: string): Promise<void> {
  const stats = await stat(path);
  context.readTracker.markRead(path, { modifiedTimeMs: stats.mtimeMs, sizeBytes: stats.size });
}

const read = (path: string) => readFile(path, "utf8");

describe("write_file", () => {
  it("creates a file and its missing folders, as previewed", async () => {
    const args = { path: "taxes/2026/checklist.md", content: "# Checklist\n- receipts\n" };
    const shown = await preview(writeFileTool, args);
    expect(shown.summary).toBe(
      "Create taxes/2026/checklist.md (23 B, 2 lines), creating 2 folders",
    );
    expect(shown.diff).toContain("+# Checklist\n+- receipts\n");
    expect(shown.targetPaths).toEqual([join(work, "taxes/2026/checklist.md")]);

    const output = await run(writeFileTool, args);
    expect(output.text).toBe("Created taxes/2026/checklist.md (23 B, 2 lines).");
    expect(await read(join(work, "taxes/2026/checklist.md"))).toBe(args.content);
  });

  it("refuses to overwrite a file that was not read", async () => {
    await writeFile(join(work, "notes.md"), "old\n");
    await expect(run(writeFileTool, { path: "notes.md", content: "new\n" })).rejects.toThrow(
      /has not been read\. Call read_file/,
    );
    expect(await read(join(work, "notes.md"))).toBe("old\n");
  });

  it("refuses to overwrite a file that changed since it was read", async () => {
    const path = join(work, "notes.md");
    await writeFile(path, "old\n");
    await markRead(path);
    await writeFile(path, "changed elsewhere\n");
    await expect(run(writeFileTool, { path: "notes.md", content: "new\n" })).rejects.toThrow(
      /changed on disk since it was read/,
    );
  });

  it("overwrites a read file, keeping line endings, trailing newline, and permissions", async () => {
    const path = join(work, "config.yaml");
    await writeFile(path, "port: 80\r\nhost: a\r\n");
    await chmod(path, 0o640);
    await markRead(path);
    const args = { path: "config.yaml", content: "port: 8080\nhost: a" };

    const shown = await preview(writeFileTool, args);
    expect(shown.summary).toBe("Overwrite config.yaml (2 lines → 2)");
    await run(writeFileTool, args);

    expect(await read(path)).toBe("port: 8080\r\nhost: a\r\n");
    expect((await stat(path)).mode & 0o777).toBe(0o640);
    expect(applyPatch("port: 80\nhost: a\n", shown.diff ?? "")).toBe("port: 8080\nhost: a\n");
    // The model now knows the file, so a second overwrite needs no new read.
    await run(writeFileTool, { path: "config.yaml", content: "port: 1\n" });
  });

  it("refuses binary content, binary files, folders, and protected paths", async () => {
    await expect(run(writeFileTool, { path: "a.txt", content: "a\0b" })).rejects.toThrow(/NUL/);
    const binary = join(work, "image.bin");
    await writeFile(binary, Buffer.from([1, 0, 2]));
    await markRead(binary);
    await expect(run(writeFileTool, { path: "image.bin", content: "x" })).rejects.toThrow(
      /binary file/,
    );
    await mkdir(join(work, "folder"));
    await expect(run(writeFileTool, { path: "folder", content: "x" })).rejects.toThrow(/folder/);
    await expect(run(writeFileTool, { path: "secrets/key", content: "x" })).rejects.toThrow(
      /protected path/,
    );
  });
});

describe("edit_file", () => {
  const path = () => join(work, "app.py");

  beforeEach(async () => {
    await writeFile(path(), "def main():\r\n    port = 80\r\n    return port\r\n");
  });

  it("replaces one exact match, keeping CRLF, as previewed", async () => {
    const args = { path: "app.py", old: "port = 80", new: "port = 8080" };
    const shown = await preview(editFileTool, args);
    expect(shown.summary).toBe("Edit app.py: replaced 1 occurrence at line 2");
    const before = (await read(path())).replace(/\r\n/g, "\n");

    const output = await run(editFileTool, args);
    expect(output.text).toBe("Edited app.py: replaced 1 occurrence at line 2.");
    const after = await read(path());
    expect(after).toBe("def main():\r\n    port = 8080\r\n    return port\r\n");
    expect(applyPatch(before, shown.diff ?? "")).toBe(after.replace(/\r\n/g, "\n"));
  });

  it("explains zero and several matches, and replaces all on request", async () => {
    await expect(run(editFileTool, { path: "app.py", old: "nothing", new: "x" })).rejects.toThrow(
      /not found.*read_file/,
    );
    await expect(run(editFileTool, { path: "app.py", old: "port", new: "p" })).rejects.toThrow(
      /found 2 times/,
    );
    const output = await run(editFileTool, {
      path: "app.py",
      old: "port",
      new: "p",
      replace_all: true,
    });
    expect(output.text).toContain("replaced 2 occurrences first at line 2");
    expect(await read(path())).toBe("def main():\r\n    p = 80\r\n    return p\r\n");
  });

  it("uses the whitespace-tolerant fallback and says so", async () => {
    const output = await run(editFileTool, {
      path: "app.py",
      old: "port = 80\nreturn port",
      new: "port = 9\nreturn port",
    });
    expect(output.text).toContain("matched ignoring whitespace");
    expect(await read(path())).toBe("def main():\r\n    port = 9\r\n    return port\r\n");
  });

  it("refuses missing files, binary files, and protected paths", async () => {
    await expect(run(editFileTool, { path: "none.py", old: "a", new: "b" })).rejects.toThrow(
      /does not exist\. Use write_file/,
    );
    await writeFile(join(work, "data.bin"), Buffer.from([0, 1]));
    await expect(run(editFileTool, { path: "data.bin", old: "a", new: "b" })).rejects.toThrow(
      /binary/,
    );
    await expect(run(editFileTool, { path: "secrets/x", old: "a", new: "b" })).rejects.toThrow(
      /protected/,
    );
  });

  it("keeps a read file current, so write_file can overwrite it afterwards", async () => {
    await markRead(path());
    await run(editFileTool, { path: "app.py", old: "80", new: "81" });
    await run(writeFileTool, { path: "app.py", content: "print(1)\n" });
    expect(await read(path())).toBe("print(1)\r\n");
  });
});

describe("make_dir", () => {
  it("creates nested folders, as previewed", async () => {
    const shown = await preview(makeDirTool, { path: "a/b/c" });
    expect(shown.summary).toBe("Create folder a/b/c and 2 missing parent folders");
    await run(makeDirTool, { path: "a/b/c" });
    expect((await stat(join(work, "a/b/c"))).isDirectory()).toBe(true);
  });

  it("does nothing for an existing folder and refuses a file or protected path", async () => {
    await mkdir(join(work, "here"));
    expect((await run(makeDirTool, { path: "here" })).text).toMatch(/already exists/);
    await writeFile(join(work, "file"), "x");
    await expect(run(makeDirTool, { path: "file" })).rejects.toThrow(/is a file/);
    await expect(run(makeDirTool, { path: "secrets/new" })).rejects.toThrow(/protected/);
  });
});
