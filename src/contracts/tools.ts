// Defining a tool (seam: every tool part → agent-loop). PRD section 6.2.

import type { z } from "zod";
import type { Config } from "../config/schema.ts";
import type { DataSourceRegistry } from "./data.ts";
import type { LmClient } from "./model.ts";
import type { ChangePreview, PathPolicy } from "./permissions.ts";
import type { ResultHandle, ResultStore } from "./results.ts";
import type { ReadTracker, VixPaths } from "./session.ts";

export type PermissionClass = "read" | "write" | "execute";
export type ToolGroup = "core" | "vision" | "data";

/** What a running tool receives. */
export interface ToolContext {
  signal: AbortSignal;
  results: ResultStore;
  paths: PathPolicy;
  dataSources: DataSourceRegistry;
  readTracker: ReadTracker;
  lm: LmClient;
  vixPaths: VixPaths;
  config: Config;
  /** Folder that relative paths resolve against: where `vix` was started. */
  workingDirectory: string;
}

/** Tools return full output. The agent loop caps it, so no tool truncates on its own. */
export interface ToolOutput {
  text: string;
  /** Results the tool already stored itself. */
  handles?: ResultHandle[];
}

export interface ToolDefinition<Parameters extends z.ZodObject = z.ZodObject> {
  name: string;
  /** At most two sentences. */
  description: string;
  /** Flat: no nested objects. */
  parameters: Parameters;
  permission: PermissionClass;
  resultTokenCap: number;
  groups: ToolGroup[];
  /** The argument shown on the tool line (CLI-4), for example "pattern" for find_files. */
  keyArgument?: keyof z.infer<Parameters> & string;
  /** Required for write and execute tools: what the call is about to change (FS-7). */
  previewChange?(args: z.infer<Parameters>, context: ToolContext): Promise<ChangePreview>;
  run(args: z.infer<Parameters>, context: ToolContext): Promise<ToolOutput>;
}

/**
 * The one error a tool should throw on purpose. Its message is shown to the
 * model as is, so it must be short, contain no stack trace or secret, and say
 * what to try next. Any other thrown error is reported to the model generically.
 */
export class ToolError extends Error {
  override readonly name = "ToolError";
}
