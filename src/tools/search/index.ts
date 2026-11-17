// search part (specs/search.md): the four read-only tools for finding and reading files.

import type { Config, ToolDefinition } from "../../contracts/index.ts";
import { findFilesTool } from "./find-files.ts";
import { listDirTool } from "./list-dir.ts";
import { readFileTool } from "./read-file.ts";
import { searchContentTool } from "./search-content.ts";

export { defaultExcludes } from "./excludes.ts";
export { createFindFilesTool, findFilesTool } from "./find-files.ts";
export { listDirTool } from "./list-dir.ts";
export { readFileTool } from "./read-file.ts";
export { SessionReadTracker } from "./read-tracker.ts";
export { ripgrepBinaryPath } from "./ripgrep.ts";
export { searchContentTool } from "./search-content.ts";
export { type Coverage, macSpotlight, type SpotlightIndex } from "./spotlight.ts";

/** Every search tool, for the agent loop's registry. */
export const searchTools: ToolDefinition[] = [
  findFilesTool,
  searchContentTool,
  listDirTool,
  readFileTool,
];

/** Every search tool with its result cap taken from the loaded config, not the built-in default. */
export function createSearchTools(config: Config): ToolDefinition[] {
  const resultTokenCap = config.context.defaultResultTokenCap;
  return searchTools.map((tool) => ({ ...tool, resultTokenCap }));
}
