// make_dir (FS-3): create a folder and any missing folders above it.

import { z } from "zod";
import { type ToolContext, ToolError } from "../../contracts/index.ts";
import { missingDirectories, statIfPresent } from "./disk.ts";
import { type ChangePlan, plannedTool } from "./planned-tool.ts";
import { plural } from "./preview.ts";
import { displayPath, resolveContentPath } from "./resolve-path.ts";

const parameters = z.object({
  path: z.string(),
});

export const makeDirTool = plannedTool({
  name: "make_dir",
  description: "Create a folder and any missing parent folders.",
  parameters,
  keyArgument: "path",
  plan: planMakeDir,
});

async function planMakeDir(
  args: z.infer<typeof parameters>,
  context: ToolContext,
): Promise<ChangePlan> {
  const realPath = await resolveContentPath(args.path, context);
  const name = displayPath(realPath, context);
  const existing = await statIfPresent(realPath);
  if (existing && !existing.isDirectory()) {
    throw new ToolError(`${name} already exists and is a file. Choose another folder name.`);
  }
  if (existing) {
    return {
      preview: { summary: `Folder ${name} already exists; nothing to change`, targetPaths: [] },
      async apply() {
        return `Folder ${name} already exists. Nothing was changed.`;
      },
    };
  }

  const parentCount = (await missingDirectories(realPath)).length - 1;
  const parentNote = parentCount > 0 ? ` and ${plural(parentCount, "missing parent folder")}` : "";
  return {
    preview: { summary: `Create folder ${name}${parentNote}`, targetPaths: [realPath] },
    async apply(recorder) {
      await recorder.createDirectories(realPath);
      return `Created folder ${name}${parentNote}.`;
    },
  };
}
