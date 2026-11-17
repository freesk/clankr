// Every tool the agent loop may offer, built from the loaded config (PRD Appendix B).
// Scoping (CTX-8) picks the subset sent each round; this list is the whole inventory.

import type { ToolReference } from "../agent/index.ts";
import { chartToolReference, createVisionSelfCheck } from "../chart/index.ts";
import { createReadResultTool } from "../context/index.ts";
import type {
  AgentEvent,
  AuditLog,
  Config,
  LoadedModel,
  PermissionGate,
  ToolDefinition,
} from "../contracts/index.ts";
import type { ChartRenderer } from "../engines/browser/index.ts";
import { createStandardHelpers, runInIsolate } from "../engines/isolate/index.ts";
import { createSearchMeaningTool } from "../semantic/index.ts";
import { createDelegateTool } from "../subagent/index.ts";
import { createExportTableTool } from "../tools/data/export-table.ts";
import { inspectDataTool } from "../tools/data/inspect/index.ts";
import { createMakeChartTool } from "../tools/data/make-chart.ts";
import { querySqlTool } from "../tools/data/query-sql.ts";
import { dataQuestionReference } from "../tools/data/question-reference.ts";
import { createRunJsTool } from "../tools/data/run-js.ts";
import { createFileTools, type FileToolDependencies } from "../tools/fs/index.ts";
import { viewImageTool } from "../tools/image/index.ts";
import { createSearchTools } from "../tools/search/index.ts";

export interface ToolSetOptions {
  config: Config;
  renderer: ChartRenderer;
  fileTools: FileToolDependencies;
  /** The session's current model, for the chart self-check (DATA-18). */
  currentModel(): LoadedModel | undefined;
  /** The current session's gate; `delegate` sends its sub-agent's calls through it. */
  permissions: PermissionGate;
  /** Sub-agent events, drawn as nested tool lines. */
  onSubAgentEvent(event: AgentEvent): void;
  /** The current session's audit log, for the sub-agent's calls. */
  currentAudit(): AuditLog;
}

export interface ToolSet {
  tools: ToolDefinition[];
  /** Reference text loaded only while its tool is in use (DATA-16). */
  toolReferences: ToolReference[];
}

export function buildToolSet(options: ToolSetOptions): ToolSet {
  const { config } = options;
  const baseTools: ToolDefinition[] = [
    ...createSearchTools(config),
    createSearchMeaningTool(config),
    createReadResultTool(config),
    ...createFileTools(options.fileTools),
    viewImageTool,
    inspectDataTool,
    querySqlTool,
    createRunJsTool(config),
    createMakeChartTool({
      runInIsolate,
      createStandardHelpers,
      renderChart: (request, signal) => options.renderer.renderChart(request, signal),
      renderChartPages: (request, signal) => options.renderer.renderChartPages(request, signal),
      renderChartImage: (spec, rows, theme, signal) =>
        options.renderer.renderChartImage(spec, rows, theme, signal),
      renderPreview: (spec, rows, theme, signal) =>
        options.renderer.renderPreview(spec, rows, theme, signal),
      selfCheck: createVisionSelfCheck(options.currentModel),
    }),
    createExportTableTool({
      renderTable: (request, signal) => options.renderer.renderTable(request, signal),
    }),
  ];
  // CTX-6: `delegate` gets the finished list and keeps only its read tools for the sub-agent.
  const delegate = createDelegateTool({
    config,
    tools: baseTools,
    permissions: options.permissions,
    onEvent: options.onSubAgentEvent,
    audit: options.currentAudit,
  });
  return {
    tools: [...baseTools, delegate],
    toolReferences: [chartToolReference, dataQuestionReference],
  };
}

/**
 * The tool definitions alone, built with dependencies that must never be called. For
 * measuring and listing what the model is offered (CTX-5), not for running tools.
 */
export function inspectToolDefinitions(config: Config): ToolDefinition[] {
  const neverCalled = (): never => {
    throw new Error("inspectToolDefinitions: these tools are for inspection only");
  };
  return buildToolSet({
    config,
    renderer: {} as ChartRenderer,
    fileTools: { trash: neverCalled },
    currentModel: () => undefined,
    permissions: { check: neverCalled },
    onSubAgentEvent: () => {},
    currentAudit: neverCalled,
  }).tools;
}

/** The tool sets scoping can offer (CTX-8, D15), each a filter over a tool's groups. */
export const offeredToolSets: Record<string, (groups: readonly string[]) => boolean> = {
  core: (groups) => groups.includes("core"),
  "core+vision": (groups) => groups.some((group) => group === "core" || group === "vision"),
  // `search_meaning` joins only while a search index exists (D90).
  "core+semantic": (groups) => groups.some((group) => group === "core" || group === "semantic"),
  all: () => true,
};
