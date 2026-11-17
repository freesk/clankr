// Test helper: a tool context whose registry is filled by hand with fixture files,
// and whose result store keeps row sets on disk so DuckDB can read them.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  DataFormat,
  DataSourceRegistry,
  DataTable,
  ToolContext,
} from "../../../contracts/index.ts";
import { createTestToolContext, InMemoryDataSourceRegistry } from "../../../testing/index.ts";
import { closeSessionEngine } from "../session-engine.ts";
import { OnDiskResultStore } from "./on-disk-result-store.ts";

export interface SqlTestContext {
  context: ToolContext;
  registry: DataSourceRegistry;
  results: OnDiskResultStore;
  /** Folder for fixture files, inside the allowed root. */
  dataDirectory: string;
  writeFixture(name: string, content: string): Promise<string>;
  register(realPath: string, format: DataFormat, tables: DataTable[]): void;
  cleanup(): Promise<void>;
}

export async function createSqlTestContext(
  overrides: Partial<ToolContext> = {},
): Promise<SqlTestContext> {
  const registry = overrides.dataSources ?? new InMemoryDataSourceRegistry();
  const base = await createTestToolContext({ dataSources: registry, ...overrides });
  const results = new OnDiskResultStore(base.context.vixPaths.session.results);
  const context: ToolContext = { ...base.context, results };
  const dataDirectory = join(context.workingDirectory, "data");
  await mkdir(dataDirectory, { recursive: true });
  let profileNumber = 0;

  return {
    context,
    registry,
    results,
    dataDirectory,
    async writeFixture(name, content) {
      const path = join(dataDirectory, name);
      await writeFile(path, content);
      return path;
    },
    register(realPath, format, tables) {
      registry.register({ handle: `p${++profileNumber}`, realPath, format, tables });
    },
    async cleanup() {
      closeSessionEngine(registry);
      await base.cleanup();
    },
  };
}

/** A CSV with `rowCount` rows: id, department (one of `groups`), amount. */
export function generatedCsv(rowCount: number, groups = 50): string {
  const lines = ["id,department,amount"];
  for (let id = 0; id < rowCount; id++) {
    lines.push(`${id},dept_${id % groups},${(id % 1000) / 10}`);
  }
  return `${lines.join("\n")}\n`;
}
