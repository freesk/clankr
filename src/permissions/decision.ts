// The decision table from specs/permissions.md, as a pure function. Paths arrive
// already classified, so every cell can be tested without a file system.

import type {
  ApprovalBasis,
  GatedTool,
  PathClassification,
  PermissionMode,
  SessionGrants,
} from "../contracts/index.ts";
import { comparisonKey } from "./canonical-path.ts";

/** `delete` asks in every mode unless granted for the session (PERM-5, D20). */
export const deleteToolName = "delete";

export interface ClassifiedChange {
  /** Every path the change writes to. */
  targets: PathClassification[];
  /** Data files the code reads (execute class). */
  dataSources: PathClassification[];
  /** A write or execute call arrived without a preview, so its targets are unknown. */
  previewMissing: boolean;
}

/** What an "always for this session" answer would grant. */
export interface GrantKeys {
  tools: string[];
  dataFiles: string[];
}

export type Verdict =
  | { kind: "allow"; basis: ApprovalBasis }
  | { kind: "refuse-denied-path"; realPath: string }
  | { kind: "refuse-read-only" }
  | { kind: "ask"; reasons: string[]; grantable: GrantKeys };

/** Grants the user gave on the command line for the whole run, not through a prompt. */
export interface RunGrants {
  /** D74 (`--allow-data`): execute-class calls on data files inside the allowed folders. */
  dataInAllowedFolders: boolean;
}

const noRunGrants: RunGrants = { dataInAllowedFolders: false };

export function decide(
  tool: GatedTool,
  mode: PermissionMode,
  grants: SessionGrants,
  change: ClassifiedChange,
  runGrants: RunGrants = noRunGrants,
): Verdict {
  const denied = [...change.targets, ...change.dataSources].find(
    (path) => path.pathClass === "denied",
  );
  if (denied) return { kind: "refuse-denied-path", realPath: denied.realPath };
  if (tool.permission === "read") return { kind: "allow", basis: "read" };
  if (mode === "read-only") return { kind: "refuse-read-only" };

  const ask = { reasons: [] as string[], grantable: { tools: [], dataFiles: [] } as GrantKeys };
  if (change.previewMissing) ask.reasons.push("no preview of the change is available");
  const outside = change.targets.filter((path) => path.pathClass === "outside");
  // Writes outside the allowed roots ask every time (PERM-3); no grant covers them.
  if (outside.length > 0) {
    ask.reasons.push(`writes outside the allowed folders: ${listPaths(outside)}`);
  }
  if (tool.permission === "write") addWriteReasons(tool, mode, grants, outside.length > 0, ask);
  else addExecuteReasons(tool, grants, change.dataSources, runGrants, ask);

  if (ask.reasons.length > 0) return { kind: "ask", ...ask };
  return { kind: "allow", basis: allowedByMode(tool, mode) ? "mode" : "grant" };
}

function addWriteReasons(
  tool: GatedTool,
  mode: PermissionMode,
  grants: SessionGrants,
  writesOutside: boolean,
  ask: { reasons: string[]; grantable: GrantKeys },
): void {
  if (writesOutside || grants.tools.has(tool.name)) return;
  if (tool.name === deleteToolName) {
    ask.reasons.push("delete always asks");
    ask.grantable.tools.push(tool.name);
  } else if (mode === "ask") {
    ask.reasons.push("ask mode confirms each change");
    ask.grantable.tools.push(tool.name);
  }
}

// Execute-class grants are keyed by data file (D19), so one approval covers later
// queries, scripts, and charts on the same file. Code that reads no data file
// falls back to a grant for the tool itself.
function addExecuteReasons(
  tool: GatedTool,
  grants: SessionGrants,
  dataSources: PathClassification[],
  runGrants: RunGrants,
  ask: { reasons: string[]; grantable: GrantKeys },
): void {
  if (dataSources.length === 0) {
    if (grants.tools.has(tool.name)) return;
    ask.reasons.push("runs code");
    ask.grantable.tools.push(tool.name);
    return;
  }
  const ungranted = dataSources.filter(
    (source) =>
      !hasDataFileGrant(grants, source.realPath) &&
      !(runGrants.dataInAllowedFolders && source.pathClass === "allowed"),
  );
  if (ungranted.length === 0) return;
  ask.reasons.push(`runs code on ${listPaths(ungranted)}`);
  ask.grantable.dataFiles.push(...ungranted.map((source) => source.realPath));
}

function allowedByMode(tool: GatedTool, mode: PermissionMode): boolean {
  return tool.permission === "write" && mode === "auto-edit" && tool.name !== deleteToolName;
}

export function hasDataFileGrant(grants: SessionGrants, realPath: string): boolean {
  const key = comparisonKey(realPath);
  for (const granted of grants.dataFiles) if (comparisonKey(granted) === key) return true;
  return false;
}

export function addGrants(grants: SessionGrants, keys: GrantKeys): void {
  for (const tool of keys.tools) grants.tools.add(tool);
  for (const dataFile of keys.dataFiles) grants.dataFiles.add(dataFile);
}

function listPaths(paths: PathClassification[]): string {
  return paths.map((path) => path.realPath).join(", ");
}
