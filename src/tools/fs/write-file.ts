// write_file (FS-1): create a text file, or replace one the model has read.

import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { type ToolContext, ToolError } from "../../contracts/index.ts";
import { missingDirectories, statFollowingLinks } from "./disk.ts";
import { type ChangePlan, plannedTool } from "./planned-tool.ts";
import { countLines, formatSize, newFileListing, plural, unifiedDiff } from "./preview.ts";
import { readStateOf, requireUnchangedSinceRead } from "./read-state.ts";
import { displayPath, resolveContentPath } from "./resolve-path.ts";
import { fingerprintOf } from "./snapshots.ts";
import {
  normalizeLineEndings,
  readTextFile,
  refuseBinaryContent,
  shapeLike,
  writeFileAtomically,
} from "./text-file.ts";

const parameters = z.object({
  path: z.string(),
  content: z.string().describe("The whole file"),
});

export const writeFileTool = plannedTool({
  name: "write_file",
  description:
    "Create a text file (and its folders), or replace a whole file you have read. To change part of a file, use edit_file.",
  parameters,
  keyArgument: "path",
  plan: planWrite,
});

async function planWrite(args: z.infer<typeof parameters>, context: ToolContext) {
  const realPath = await resolveContentPath(args.path, context);
  const name = displayPath(realPath, context);
  refuseBinaryContent(args.content, name);
  const existing = await statFollowingLinks(realPath);
  if (existing?.isDirectory()) {
    throw new ToolError(`${name} is a folder. Give a file path inside it.`);
  }
  return existing
    ? planOverwrite(realPath, name, args.content, existing, context)
    : planCreate(realPath, name, args.content, context);
}

async function planCreate(
  realPath: string,
  name: string,
  content: string,
  context: ToolContext,
): Promise<ChangePlan> {
  const newFolders = await missingDirectories(dirname(realPath));
  const folderNote =
    newFolders.length > 0 ? `, creating ${plural(newFolders.length, "folder")}` : "";
  const size = `${formatSize(Buffer.byteLength(content))}, ${plural(countLines(content), "line")}`;
  return {
    preview: {
      summary: `Create ${name} (${size})${folderNote}`,
      diff: newFileListing(name, normalizeLineEndings(content)),
      targetPaths: [realPath],
    },
    async apply(recorder) {
      await recorder.createDirectories(dirname(realPath));
      await writeFileAtomically(realPath, content);
      const written = await stat(realPath);
      recorder.record({ kind: "remove-created", path: realPath, after: fingerprintOf(written) });
      context.readTracker.markRead(realPath, readStateOf(written));
      return `Created ${name} (${size}).`;
    },
  };
}

async function planOverwrite(
  realPath: string,
  name: string,
  content: string,
  existing: Stats,
  context: ToolContext,
): Promise<ChangePlan> {
  requireUnchangedSinceRead(context.readTracker, realPath, existing, name);
  const original = await readTextFile(realPath, name);
  const newText = shapeLike(normalizeLineEndings(content), original);
  const newLineCount = countLines(normalizeLineEndings(newText));
  return {
    preview: {
      summary: `Overwrite ${name} (${plural(countLines(original.text), "line")} → ${newLineCount})`,
      diff: await unifiedDiff(name, original.text, normalizeLineEndings(newText)),
      targetPaths: [realPath],
    },
    async apply(recorder) {
      const backup = await recorder.backup(realPath);
      await writeFileAtomically(realPath, newText, existing.mode & 0o7777);
      const written = await stat(realPath);
      recorder.record({
        kind: "restore-content",
        path: realPath,
        backup,
        after: fingerprintOf(written),
      });
      context.readTracker.markRead(realPath, readStateOf(written));
      return `Overwrote ${name} (${plural(newLineCount, "line")}).`;
    },
  };
}
