// move (FS-4, FS-10): move or rename files and folders, never overwriting.

import { lstat } from "node:fs/promises";
import type { ToolContext } from "../../contracts/index.ts";
import { moveEntry } from "./disk.ts";
import { type ChangePlan, plannedTool } from "./planned-tool.ts";
import { fingerprintOf } from "./snapshots.ts";
import {
  describeTransfers,
  planTransfers,
  type TransferArguments,
  transferParameters,
} from "./transfer-plan.ts";
import type { FileToolDependencies } from "./trash.ts";

export function createMoveTool(dependencies: FileToolDependencies) {
  return plannedTool({
    name: "move",
    description:
      "Move or rename files and folders; several sources go into one destination folder. " +
      "Never overwrites an existing file.",
    parameters: transferParameters,
    keyArgument: "destination",
    plan: (args, context) => planMove(args, context, dependencies),
  });
}

async function planMove(
  args: TransferArguments,
  context: ToolContext,
  dependencies: FileToolDependencies,
): Promise<ChangePlan> {
  const plan = await planTransfers(args, context);
  const description = describeTransfers(plan, context);
  const { transfers } = plan;
  return {
    preview: {
      summary: `Move ${description}`,
      // A move writes to both ends: the source disappears and the target appears.
      targetPaths: [
        ...(plan.destinationFolder ? [plan.destinationFolder] : []),
        ...transfers.flatMap(({ source, target }) => [source, target]),
      ],
    },
    async apply(recorder) {
      if (plan.destinationFolder) await recorder.createDirectories(plan.destinationFolder);
      for (const { source, target } of transfers) {
        await moveEntry(source, target, dependencies.trash);
        const after = fingerprintOf(await lstat(target));
        recorder.record({ kind: "move-back", from: source, to: target, after });
      }
      return `Moved ${description}.`;
    },
  };
}
