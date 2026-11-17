// The golden task format. A task is data: a prompt, the fixtures to set up, and
// assertions on the outcome. Adding a task needs a JSON entry, not new code.
// Every path is relative to the task's temporary working directory.

import { z } from "zod";

export const scenarioIds = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10"] as const;
export type ScenarioId = (typeof scenarioIds)[number];

const relativePath = z
  .string()
  .min(1)
  .refine((path) => !path.startsWith("/") && !path.split("/").includes(".."), {
    message: "must be relative to the task directory and must not contain ..",
  });

// ---------------------------------------------------------------- fixtures

const textFixture = z.object({
  kind: z.literal("text"),
  path: relativePath,
  content: z.string(),
  /** ISO date, for metadata searches (S1). */
  modifiedAt: z.iso.datetime({ offset: true }).optional(),
});

const directoryFixture = z.object({
  kind: z.literal("directory"),
  path: relativePath,
});

const generatedFixture = z.object({
  kind: z.literal("generated"),
  generator: z.enum(["png-text", "png-shape", "xlsx", "csv", "docx", "pdf"]),
  path: relativePath,
  /** Generator-specific; each generator validates its own options. */
  options: z.record(z.string(), z.unknown()).default({}),
  modifiedAt: z.iso.datetime({ offset: true }).optional(),
});

export const fixtureSchema = z.discriminatedUnion("kind", [
  textFixture,
  directoryFixture,
  generatedFixture,
]);
export type Fixture = z.infer<typeof fixtureSchema>;
export type GeneratedFixture = z.infer<typeof generatedFixture>;

// ---------------------------------------------------------------- steps

const promptStep = z.object({ prompt: z.string().min(1) });
/** A slash command, for example "/model google/gemma-4-12b-qat" (S10). */
const commandStep = z.object({ command: z.string().startsWith("/") });

export const stepSchema = z.union([promptStep, commandStep]);
export type Step = z.infer<typeof stepSchema>;

// ---------------------------------------------------------------- assertions

export const assertionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file-exists"), path: relativePath }),
  z.object({ kind: z.literal("file-absent"), path: relativePath }),
  z.object({ kind: z.literal("directory-exists"), path: relativePath }),
  z.object({ kind: z.literal("file-contains"), path: relativePath, text: z.string().min(1) }),
  z.object({ kind: z.literal("file-not-contains"), path: relativePath, text: z.string().min(1) }),
  /** The file still has the content its fixture gave it. */
  z.object({ kind: z.literal("file-unchanged"), path: relativePath }),
  /** Counts files (not folders) directly inside a folder whose names end with the suffix. */
  z.object({
    kind: z.literal("file-count"),
    directory: z.union([relativePath, z.literal(".")]),
    suffix: z.string().default(""),
    count: z.number().int().nonnegative(),
  }),
  /** At least one of the strings appears in the final answer, ignoring case. */
  z.object({ kind: z.literal("answer-contains"), anyOf: z.array(z.string().min(1)).min(1) }),
  /** None of the strings appears in the final answer, ignoring case. */
  z.object({ kind: z.literal("answer-not-contains"), noneOf: z.array(z.string().min(1)).min(1) }),
  /** Some number in the final answer is within the tolerance of the value. */
  z.object({
    kind: z.literal("answer-number"),
    value: z.number(),
    tolerance: z.number().nonnegative().default(0),
  }),
  z.object({ kind: z.literal("tool-called"), tool: z.string() }),
  z.object({ kind: z.literal("tool-not-called"), tool: z.string() }),
  /** A valid PDF exists somewhere under the folder, searched recursively. */
  z.object({ kind: z.literal("pdf-created"), directory: z.union([relativePath, z.literal(".")]) }),
  /** A saved Vega-Lite spec under the folder has this mark and encodes these fields. */
  z.object({
    kind: z.literal("chart-spec"),
    directory: z.union([relativePath, z.literal(".")]),
    /** Left out when the prompt does not name a chart type. */
    mark: z.string().optional(),
    fields: z.array(z.string()).default([]),
    stacked: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("active-model"), key: z.string() }),
]);
export type Assertion = z.infer<typeof assertionSchema>;

// ---------------------------------------------------------------- task

export const taskSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  scenario: z.enum(scenarioIds),
  title: z.string().min(1),
  /** Tool names, or "command:<name>" for a slash command. Missing ones skip the task. */
  requires: z.array(z.string()).min(1),
  fixtures: z.array(fixtureSchema).default([]),
  steps: z.array(stepSchema).min(1),
  assertions: z.array(assertionSchema).min(1),
  /** Counts toward the chart metric (PRD section 10). */
  chart: z.boolean().default(false),
});
export type GoldenTask = z.infer<typeof taskSchema>;

export const taskFileSchema = z.array(taskSchema);
