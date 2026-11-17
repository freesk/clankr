// The schema for `~/.clankr/config.json`. Every default in the harness is defined here, once.
// Parts that need a new setting add a field here; they do not hard-code a default.

import { z } from "zod";

/**
 * How LM Studio loads a model, beyond its context length. Only settings LM Studio's REST
 * load API accepts; GPU offload and KV-cache quantization are left to LM Studio (D78).
 */
const loadSettingsSchema = z.object({
  /** Request slots LM Studio reserves memory for. clankr sends one request at a time. */
  parallel: z.number().int().positive().optional(),
  flashAttention: z.boolean().optional(),
  offloadKvCacheToGpu: z.boolean().optional(),
  evalBatchSize: z.number().int().positive().optional(),
});

const modelProfileSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  topK: z.number().int().positive().optional(),
  topP: z.number().min(0).max(1).optional(),
  contextLength: z.number().int().positive().optional(),
  reasoning: z.enum(["on", "off"]).optional(),
  toolCallingStyle: z.enum(["native", "prompt"]).optional(),
  /** Overrides `model.load` for this model, setting by setting. */
  load: loadSettingsSchema.optional(),
});

const lmStudioSchema = z.object({
  baseUrl: z.string().url().default("http://localhost:1234"),
  /** Prefer the LM_API_TOKEN environment variable. Never logged or sent to the model (MOD-2). */
  apiToken: z.string().min(1).optional(),
  /** SEC-1: a non-loopback host is refused unless this is set. */
  allowNonLoopbackHost: z.boolean().default(false),
});

const modelSchema = z.object({
  default: z.string().default("google/gemma-4-12b-qat"),
  contextLength: z.number().int().positive().default(16_384),
  unloadPreviousOnSwitch: z.boolean().default(false),
  /**
   * Load settings for every model. One slot saves about 0.9 GB on Gemma 4 12B at a 16k
   * context with no speed cost (D78); unset fields use LM Studio's own defaults.
   */
  load: loadSettingsSchema.prefault({}).transform((settings) => ({ parallel: 1, ...settings })),
  /** Keyed by model key (MOD-9). */
  profiles: z.record(z.string(), modelProfileSchema).default({}),
});

const permissionsSchema = z.object({
  mode: z.enum(["ask", "auto-edit", "read-only"]).default("ask"),
  /** Empty means the folder `clankr` was started in (PERM-3). The loader fills it in. */
  allowedRoots: z.array(z.string()).default([]),
  /** Added to the built-in deny list (PERM-4), never replacing it. */
  extraDeniedPaths: z.array(z.string()).default([]),
});

const contextSchema = z.object({
  /** Shares of the loaded context length (PRD section 7.1). */
  budgetShares: z
    .object({
      fixedOverhead: z.number().default(0.1),
      history: z.number().default(0.45),
      toolResults: z.number().default(0.2),
      response: z.number().default(0.25),
    })
    .prefault({}),
  defaultResultTokenCap: z.number().int().positive().default(800),
  compactionThreshold: z.number().min(0.1).max(0.95).default(0.7),
  /** Share of the context length that compaction aims to get back under, so it does not re-run every turn. */
  compactionTarget: z.number().min(0.05).max(0.9).default(0.5),
  /** Most of the context length a compaction summary note may take. */
  summaryShare: z.number().min(0.01).max(0.3).default(0.08),
  evictToolResultsAfterTurns: z.number().int().positive().default(3),
});

const agentSchema = z.object({
  maxToolRoundsPerTurn: z.number().int().positive().default(20),
  maxConsecutiveInvalidCalls: z.number().int().positive().default(3),
});

const subagentsSchema = z.object({
  turnLimit: z.number().int().positive().default(8),
  summaryTokenCap: z.number().int().positive().default(300),
});

const imageSchema = z.object({
  /** Provisional until the M3 measurement settles it (specs/image.md). */
  maxEdgePixels: z.number().int().positive().default(1024),
  /** Answer allowance for a question about an image (IMG-1). */
  answerTokens: z.number().int().positive().default(1024),
  /** Answer allowance in transcribe mode, which returns more text (IMG-5). */
  transcribeAnswerTokens: z.number().int().positive().default(4096),
  /** How long the macOS `sips` conversion (IMG-4) may run. */
  conversionTimeoutMs: z.number().int().positive().default(30_000),
});

const dataSchema = z.object({
  /** Rows a chart accepts (DATA-17), and rows the isolate's `data` and `save` helpers pass. One number. */
  rowCap: z.number().int().positive().default(50_000),
  /** Limits on the V8 isolate that runs `run_js` and `make_chart` code (specs/sandbox.md). */
  isolateTimeoutMs: z.number().int().positive().default(5_000),
  isolateMemoryLimitMb: z.number().int().positive().default(128),
  /** How long the chart browser stays open after the last render (D30). */
  browserIdleSeconds: z.number().int().positive().default(60),
  /** `query_sql` limits (DATA-9, specs/sql.md). The timeout interrupts the running query. */
  sqlTimeoutMs: z.number().int().positive().default(30_000),
  /** DuckDB's memory limit. Above it DuckDB spills to the session scratch folder or fails. */
  sqlMemoryLimitMb: z.number().int().positive().default(2_048),
  /** Most rows of one query result kept in the result store. */
  sqlStoredRowLimit: z.number().int().positive().default(1_000_000),
  /** Rows of a query result shown to the model; the rest stay behind the handle. */
  sqlPreviewRows: z.number().int().positive().default(20),
  /** Columns per sheet printed by `inspect_data`; wider sheets point to the stored profile. */
  profileColumnsShown: z.number().int().positive().default(40),
  /** DATA-5: column names (case-insensitive) whose sample values and min/max are masked. */
  sensitiveColumns: z.array(z.string()).default([]),
});

const searchSchema = z.object({
  /** Hits a search tool lists before storing the rest behind a handle (SRCH-6). */
  maxHits: z.number().int().positive().default(50),
  /** Entries `list_dir` lists before storing the rest behind a handle. */
  maxListEntries: z.number().int().positive().default(200),
  /** Longer lines are cut with a marker, so one minified line cannot fill the result. */
  maxLineLength: z.number().int().positive().default(300),
  /** Lines `read_file` returns when the call names no line count. */
  readFileDefaultLines: z.number().int().positive().default(200),
  /** Most paths taken from one Spotlight query before asking the model to narrow it. */
  spotlightMaxResults: z.number().int().positive().default(20_000),
  /** Bounds on the directory walk that replaces Spotlight where the index is unavailable. */
  walkTimeLimitMs: z.number().int().positive().default(10_000),
  walkMaxEntries: z.number().int().positive().default(500_000),
});

export const configSchema = z.object({
  lmStudio: lmStudioSchema.prefault({}),
  model: modelSchema.prefault({}),
  permissions: permissionsSchema.prefault({}),
  context: contextSchema.prefault({}),
  agent: agentSchema.prefault({}),
  subagents: subagentsSchema.prefault({}),
  image: imageSchema.prefault({}),
  data: dataSchema.prefault({}),
  search: searchSchema.prefault({}),
});

export type Config = z.infer<typeof configSchema>;
export type ConfigInput = z.input<typeof configSchema>;
export type ModelProfile = z.infer<typeof modelProfileSchema>;
export type LoadSettingsConfig = z.infer<typeof loadSettingsSchema>;
