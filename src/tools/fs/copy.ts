// copy (FS-5, FS-10): duplicate files or whole folder trees, never overwriting.

import { lstat } from "node:fs/promises";
import type { ToolContext } from "../../contracts/index.ts";
import { copyEntry } from "./disk.ts";
import { type ChangePlan, plannedTool } from "./planned-tool.ts";
import { fingerprintOf } from "./snapshots.ts";
import {
  describeTransfers,
  planTransfers,
  type TransferArguments,
  transferParameters,
} from "./transfer-plan.ts";

export const copyTool = plannedTool({
  name: "copy",
  description: "Copy files or whole folders. Never overwrites a file.",
  parameters: transferParameters,
  keyArgument: "destination",
  plan: planCopy,
});

async function planCopy(args: TransferArguments, context: ToolContext): Promise<ChangePlan> {
  const plan = await planTransfers(args, context);
  const description = describeTransfers(plan, context);
  const targets = plan.transfers.map(({ target }) => target);
  return {
    preview: {
      summary: `Copy ${description}`,
      targetPaths: plan.destinationFolder ? [plan.destinationFolder, ...targets] : targets,
    },
    async apply(recorder) {
      if (plan.destinationFolder) await recorder.createDirectories(plan.destinationFolder);
      for (const { source, target } of plan.transfers) {
        await copyEntry(source, target);
        const after = fingerprintOf(await lstat(target));
        recorder.record({ kind: "remove-created", path: target, after });
      }
      return `Copied ${description}.`;
    },
  };
}
