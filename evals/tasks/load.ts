// Loads and validates the golden tasks from evals/tasks/golden/*.json.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type GoldenTask, taskFileSchema } from "./schema.ts";

export const goldenTaskDirectory = fileURLToPath(new URL("./golden/", import.meta.url));

export async function loadGoldenTasks(directory = goldenTaskDirectory): Promise<GoldenTask[]> {
  const fileNames = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  const tasks: GoldenTask[] = [];
  for (const fileName of fileNames) {
    tasks.push(...(await loadTaskFile(join(directory, fileName))));
  }
  assertUniqueIds(tasks);
  return tasks;
}

async function loadTaskFile(path: string): Promise<GoldenTask[]> {
  const json: unknown = JSON.parse(await readFile(path, "utf8"));
  const parsed = taskFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Invalid task file ${path}:\n${parsed.error.message}`);
  }
  return parsed.data;
}

function assertUniqueIds(tasks: GoldenTask[]): void {
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) throw new Error(`Duplicate golden task id "${task.id}"`);
    seen.add(task.id);
  }
}
