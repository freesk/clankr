// delete (FS-6): move a file or folder to the macOS Trash. Nothing is deleted permanently.

import { z } from "zod";
import { type ToolContext, ToolError } from "../../contracts/index.ts";
import { pathExists, statIfPresent } from "./disk.ts";
import { type ChangePlan, plannedTool } from "./planned-tool.ts";
import { formatSize } from "./preview.ts";
import { displayPath, resolveEntryPath } from "./resolve-path.ts";
import type { FileToolDependencies } from "./trash.ts";

const parameters = z.object({
  path: z.string(),
});

export function createDeleteTool(dependencies: FileToolDependencies) {
  return plannedTool({
    name: "delete",
    description: "Move a file or folder to the Trash.",
    parameters,
    keyArgument: "path",
    plan: (args, context) => planDelete(args, context, dependencies),
  });
}

async function planDelete(
  args: z.infer<typeof parameters>,
  context: ToolContext,
  dependencies: FileToolDependencies,
): Promise<ChangePlan> {
  const entry = await resolveEntryPath(args.path, context);
  const name = displayPath(entry, context);
  const stats = await statIfPresent(entry);
  if (!stats) {
    throw new ToolError(`${args.path} does not exist. Check the path with list_dir or find_files.`);
  }
  const kind = stats.isDirectory() ? "folder" : `file, ${formatSize(stats.size)}`;
  return {
    preview: { summary: `Move ${name} (${kind}) to the Trash`, targetPaths: [entry] },
    async apply(recorder) {
      // A full copy first, so `/undo` can put it back without reaching into the Trash.
      const backup = await recorder.backup(entry);
      await dependencies.trash([entry]);
      if (await pathExists(entry)) {
        throw new ToolError(`${name} could not be moved to the Trash. Nothing was deleted.`);
      }
      recorder.record({ kind: "restore-deleted", path: entry, backup });
      return `Moved ${name} to the Trash.`;
    },
  };
}
