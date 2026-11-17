// files part (specs/files.md): the six file tools and `/undo`.

import type { SlashCommand, ToolDefinition, VixPaths } from "../../contracts/index.ts";
import { copyTool } from "./copy.ts";
import { createDeleteTool } from "./delete.ts";
import { editFileTool } from "./edit-file.ts";
import { makeDirTool } from "./make-dir.ts";
import { createMoveTool } from "./move.ts";
import { defaultFileToolDependencies, type FileToolDependencies } from "./trash.ts";
import { createUndoCommand } from "./undo.ts";
import { writeFileTool } from "./write-file.ts";

export type { FileToolDependencies, TrashFunction } from "./trash.ts";
export { moveToSystemTrash } from "./trash.ts";
export { undoLastChange } from "./undo.ts";

/** `write_file`, `edit_file`, `make_dir`, `move`, `copy`, and `delete`, all core and write-class. */
export function createFileTools(
  dependencies: FileToolDependencies = defaultFileToolDependencies,
): ToolDefinition[] {
  return [
    writeFileTool,
    editFileTool,
    makeDirTool,
    createMoveTool(dependencies),
    copyTool,
    createDeleteTool(dependencies),
  ];
}

/** `/undo` for the session whose snapshots live under `vixPaths.session.snapshots`. */
export function createFileSlashCommands(
  vixPaths: VixPaths,
  dependencies: FileToolDependencies = defaultFileToolDependencies,
): SlashCommand[] {
  return [createUndoCommand({ ...dependencies, snapshotsDirectory: vixPaths.session.snapshots })];
}
