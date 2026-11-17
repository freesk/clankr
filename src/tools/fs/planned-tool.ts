// Every file tool is built the same way: a `plan` step that checks everything and describes
// the change, and an `apply` step that makes it. Both `previewChange` and `run` start from a
// fresh plan, so the preview the user approves is exactly what `run` does (FS-7).

import type { z } from "zod";
import type {
  ChangePreview,
  ToolContext,
  ToolDefinition,
  ToolOutput,
} from "../../contracts/index.ts";
import { type ChangeRecorder, SnapshotStore } from "./snapshots.ts";

export interface ChangePlan {
  preview: ChangePreview;
  /** Makes the change, recording how to undo each step. Returns the text for the model. */
  apply(recorder: ChangeRecorder): Promise<string>;
}

/** Results are one or two lines, so a small cap is plenty. */
const fileToolResultTokenCap = 200;

interface PlannedToolDefinition<Parameters extends z.ZodObject> {
  name: string;
  description: string;
  parameters: Parameters;
  keyArgument: keyof z.infer<Parameters> & string;
  plan(args: z.infer<Parameters>, context: ToolContext): Promise<ChangePlan>;
}

export function plannedTool<Parameters extends z.ZodObject>(
  definition: PlannedToolDefinition<Parameters>,
): ToolDefinition<Parameters> {
  return {
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    permission: "write",
    resultTokenCap: fileToolResultTokenCap,
    groups: ["core"],
    keyArgument: definition.keyArgument,
    async previewChange(args, context) {
      return (await definition.plan(args, context)).preview;
    },
    async run(args, context): Promise<ToolOutput> {
      const plan = await definition.plan(args, context);
      return { text: await applyWithSnapshot(plan, context) };
    },
  };
}

async function applyWithSnapshot(plan: ChangePlan, context: ToolContext): Promise<string> {
  const store = new SnapshotStore(context.clankrPaths.session.snapshots);
  const recorder = await store.begin(plan.preview.summary);
  try {
    return await plan.apply(recorder);
  } finally {
    await recorder.finish();
  }
}
