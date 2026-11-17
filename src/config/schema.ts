// The schema for `~/.vix/config.json`. Every default in the harness is defined here, once.
// Parts that need a new setting add a field here; they do not hard-code a default.

import { z } from "zod";

const modelProfileSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  topK: z.number().int().positive().optional(),
  topP: z.number().min(0).max(1).optional(),
  contextLength: z.number().int().positive().optional(),
  reasoning: z.enum(["on", "off"]).optional(),
  toolCallingStyle: z.enum(["native", "prompt"]).optional(),
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
  /** Keyed by model key (MOD-9). */
  profiles: z.record(z.string(), modelProfileSchema).default({}),
});

const permissionsSchema = z.object({
  mode: z.enum(["ask", "auto-edit", "read-only"]).default("ask"),
  /** Empty means the folder `vix` was started in (PERM-3). The loader fills it in. */
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
});

const dataSchema = z.object({
  /** Rows a chart accepts (DATA-17), and rows the isolate's `data` and `save` helpers pass. One number. */
  rowCap: z.number().int().positive().default(50_000),
  /** Limits on the V8 isolate that runs `run_js` and `make_chart` code (specs/sandbox.md). */
  isolateTimeoutMs: z.number().int().positive().default(5_000),
  isolateMemoryLimitMb: z.number().int().positive().default(128),
  /** How long the chart browser stays open after the last render (D30). */
  browserIdleSeconds: z.number().int().positive().default(60),
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
});

export type Config = z.infer<typeof configSchema>;
export type ConfigInput = z.input<typeof configSchema>;
export type ModelProfile = z.infer<typeof modelProfileSchema>;
