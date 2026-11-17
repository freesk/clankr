// edit_file (FS-2, FS-8): replace exact text in a text file, with a whitespace-tolerant
// fallback when the exact text is not found.

import { stat } from "node:fs/promises";
import { z } from "zod";
import { type ToolContext, ToolError } from "../../contracts/index.ts";
import { statIfPresent } from "./disk.ts";
import { type ChangePlan, plannedTool } from "./planned-tool.ts";
import { plural, unifiedDiff } from "./preview.ts";
import { carryReadStateForward } from "./read-state.ts";
import { displayPath, resolveContentPath } from "./resolve-path.ts";
import { fingerprintOf } from "./snapshots.ts";
import { normalizeLineEndings, readTextFile, shapeLike, writeFileAtomically } from "./text-file.ts";
import { planReplacement, type Replacement } from "./text-match.ts";

const parameters = z.object({
  path: z.string().describe("File to edit."),
  old: z.string().describe("The exact text to replace, copied from the file."),
  new: z.string().describe("The text to put in its place."),
  replace_all: z
    .boolean()
    .default(false)
    .describe("Replace every occurrence instead of requiring exactly one."),
});

export const editFileTool = plannedTool({
  name: "edit_file",
  description:
    "Replace text in a file: old must match exactly once unless replace_all is true. " +
    "Copy old from read_file output.",
  parameters,
  keyArgument: "path",
  plan: planEdit,
});

async function planEdit(
  args: z.infer<typeof parameters>,
  context: ToolContext,
): Promise<ChangePlan> {
  const realPath = await resolveContentPath(args.path, context);
  const name = displayPath(realPath, context);
  const before = await statIfPresent(realPath);
  if (!before) throw new ToolError(`${name} does not exist. Use write_file to create it.`);
  if (before.isDirectory()) throw new ToolError(`${name} is a folder, not a file.`);

  const original = await readTextFile(realPath, name);
  const replacement = planReplacement({
    text: original.text,
    oldText: normalizeLineEndings(args.old),
    newText: normalizeLineEndings(args.new),
    replaceAll: args.replace_all,
    displayName: name,
  });
  const newContents = shapeLike(replacement.text, original);
  const what = describeReplacement(replacement);

  return {
    preview: {
      summary: `Edit ${name}: ${what}`,
      diff: await unifiedDiff(name, original.text, normalizeLineEndings(newContents)),
      targetPaths: [realPath],
    },
    async apply(recorder) {
      const backup = await recorder.backup(realPath);
      await writeFileAtomically(realPath, newContents, before.mode & 0o7777);
      const after = await stat(realPath);
      recorder.record({
        kind: "restore-content",
        path: realPath,
        backup,
        after: fingerprintOf(after),
      });
      carryReadStateForward(context.readTracker, realPath, before, after);
      const caution = replacement.whitespaceTolerant
        ? " The text matched only when ignoring whitespace; read the changed lines to check them."
        : "";
      return `Edited ${name}: ${what}.${caution}`;
    },
  };
}

function describeReplacement(replacement: Replacement): string {
  const where = `${replacement.matchCount > 1 ? "first " : ""}at line ${replacement.firstLine}`;
  const tolerance = replacement.whitespaceTolerant ? ", matched ignoring whitespace" : "";
  return `replaced ${plural(replacement.matchCount, "occurrence")} ${where}${tolerance}`;
}
