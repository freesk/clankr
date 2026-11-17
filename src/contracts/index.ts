// Shared contracts. Types only, plus ToolError and the output format list with its membership check.
// Wave 1 parts import from here and from src/testing/, never from each other.
// Change by agreement only: add fields, avoid renaming.

export type { Config } from "../config/schema.ts";
export type * from "./context.ts";
export type * from "./data.ts";
export type * from "./events.ts";
export type * from "./isolate.ts";
export type * from "./model.ts";
export type * from "./output.ts";
export { isOutputFormat, outputFormatLabels, outputFormats } from "./output.ts";
export type * from "./permissions.ts";
export type * from "./results.ts";
export type * from "./session.ts";
export type * from "./session-store.ts";
export type {
  PermissionClass,
  ToolContext,
  ToolDefinition,
  ToolGroup,
  ToolOutput,
} from "./tools.ts";
export { ToolError } from "./tools.ts";
export type * from "./turn.ts";
