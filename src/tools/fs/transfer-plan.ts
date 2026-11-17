// Shared planning for `move` and `copy` (FS-4, FS-5, FS-10). Every source and target is
// checked before anything changes, so one bad source in a list leaves the disk untouched.

import { basename, join, sep } from "node:path";
import { z } from "zod";
import { type ToolContext, ToolError } from "../../contracts/index.ts";
import { isOccupiedByAnother, pathExists, statFollowingLinks } from "./disk.ts";
import { plural } from "./preview.ts";
import { displayPath, resolveContentPath, resolveEntryPath } from "./resolve-path.ts";

export const transferParameters = z.object({
  sources: z
    .array(z.string())
    .min(1)
    .describe("One or more files or folders. Several sources go into the destination folder."),
  destination: z
    .string()
    .describe("New path for a single source, or the folder that receives the sources."),
});

export type TransferArguments = z.infer<typeof transferParameters>;

export interface Transfer {
  source: string;
  target: string;
}

export interface TransferPlan {
  transfers: Transfer[];
  /** Set when the sources go into a folder. */
  destinationFolder?: string;
  /** True when that folder does not exist yet and will be created. */
  createsDestinationFolder: boolean;
}

export async function planTransfers(
  args: TransferArguments,
  context: ToolContext,
): Promise<TransferPlan> {
  const sources = await resolveSources(args.sources, context);
  const intoFolder = await destinationIsFolder(args, context);
  const destinationFolder = intoFolder
    ? await resolveContentPath(args.destination, context)
    : undefined;
  const transfers = destinationFolder
    ? sources.map((source) => ({ source, target: join(destinationFolder, basename(source)) }))
    : // A single source with a destination that is not a folder is a rename.
      [{ source: sources[0] ?? "", target: await resolveEntryPath(args.destination, context) }];

  await checkTargets(transfers, context);
  return {
    transfers,
    destinationFolder,
    createsDestinationFolder:
      destinationFolder !== undefined && !(await pathExists(destinationFolder)),
  };
}

async function resolveSources(paths: string[], context: ToolContext): Promise<string[]> {
  const sources: string[] = [];
  const problems: string[] = [];
  for (const path of paths) {
    const source = await resolveEntryPath(path, context);
    if (!(await pathExists(source))) problems.push(`${path} does not exist.`);
    else if (sources.includes(source)) problems.push(`${path} is listed twice.`);
    else sources.push(source);
  }
  failIfProblems(problems, "Check the paths with list_dir or find_files.");
  return sources;
}

/** Several sources always go into a folder; one source goes into an existing folder. */
async function destinationIsFolder(args: TransferArguments, context: ToolContext) {
  const destination = await resolveContentPath(args.destination, context);
  const existing = await statFollowingLinks(destination);
  if (args.sources.length === 1) return existing?.isDirectory() === true;
  if (existing && !existing.isDirectory()) {
    throw new ToolError(
      `${args.destination} is a file. With several sources, the destination must be a folder.`,
    );
  }
  return true;
}

async function checkTargets(transfers: Transfer[], context: ToolContext): Promise<void> {
  const problems: string[] = [];
  const seenTargets = new Set<string>();
  for (const { source, target } of transfers) {
    // Classifying the target refuses protected paths before anything is written there.
    await resolveEntryPath(target, context);
    const name = displayPath(target, context);
    if (target === source) {
      problems.push(`${name} is already there.`);
    } else if (target.startsWith(source + sep)) {
      problems.push(`${displayPath(source, context)} cannot go inside itself.`);
    } else if (seenTargets.has(target)) {
      problems.push(`Two sources would both become ${name}.`);
    } else if (await isOccupiedByAnother(target, source)) {
      problems.push(`${name} already exists and will not be overwritten.`);
    }
    seenTargets.add(target);
  }
  failIfProblems(problems, "Nothing was changed. Choose another destination or name.");
}

function failIfProblems(problems: string[], advice: string): void {
  if (problems.length > 0) throw new ToolError(`${problems.join(" ")} ${advice}`);
}

/** "notes.md to archive/notes.md" or "3 items into archive". */
export function describeTransfers(plan: TransferPlan, context: ToolContext): string {
  const [first] = plan.transfers;
  if (!plan.destinationFolder && first) {
    return `${displayPath(first.source, context)} to ${displayPath(first.target, context)}`;
  }
  const folder = displayPath(plan.destinationFolder ?? "", context);
  const items =
    plan.transfers.length === 1 && first
      ? displayPath(first.source, context)
      : plural(plan.transfers.length, "item");
  const creating = plan.createsDestinationFolder ? " (new folder)" : "";
  return `${items} into ${folder}${creating}`;
}
