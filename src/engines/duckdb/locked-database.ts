// Opening a locked-down DuckDB instance (DATA-7). The layers, as verified in the
// foundation spike (specs/foundation.md, "Spike findings"):
//   1. extension install and autoload off, unsigned and community extensions refused;
//   2. the vendored Excel reader loaded from disk before anything is locked;
//   3. file access limited to an explicit list of files (never a directory, because
//      configuration alone does not stop `COPY ... TO` an allowed directory);
//   4. external access off, then the configuration locked so SQL cannot undo any of it.
// The statement check (statement-check.ts) is the layer on top for model-written SQL.

import type { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { loadDuckDb, requireExcelExtension } from "./load-duckdb.ts";
import { quoteLiteral } from "./sql-text.ts";

export interface LockedDatabaseOptions {
  /** Real paths of the only files SQL may read. */
  allowedFiles: string[];
  /** Where DuckDB spills when a query outgrows memory: the session's scratch folder. */
  scratchDirectory: string;
  memoryLimitMb: number;
  /** Load the vendored Excel reader. Only needed when an `.xlsx` file is read. */
  loadExcelReader: boolean;
}

export interface LockedDatabase {
  readonly connection: DuckDBConnection;
  close(): void;
}

export async function openLockedDatabase(options: LockedDatabaseOptions): Promise<LockedDatabase> {
  const { DuckDBInstance } = await loadDuckDb();
  const instance = await DuckDBInstance.create(":memory:", {
    autoinstall_known_extensions: "false",
    autoload_known_extensions: "false",
    allow_community_extensions: "false",
    allow_unsigned_extensions: "false",
    temp_directory: options.scratchDirectory,
    memory_limit: `${options.memoryLimitMb}MB`,
  });
  const connection = await instance.connect();
  try {
    await lockDown(connection, options);
  } catch (error) {
    closeQuietly(connection, instance);
    throw error;
  }
  return { connection, close: () => closeQuietly(connection, instance) };
}

async function lockDown(
  connection: DuckDBConnection,
  options: LockedDatabaseOptions,
): Promise<void> {
  if (options.loadExcelReader) {
    await connection.run(`LOAD ${quoteLiteral(requireExcelExtension())}`);
  }
  const fileList = options.allowedFiles.map(quoteLiteral).join(", ");
  await connection.run(`SET allowed_paths = [${fileList}]`);
  await connection.run("SET enable_external_access = false");
  await connection.run("SET lock_configuration = true");
}

function closeQuietly(connection: DuckDBConnection, instance: DuckDBInstance): void {
  connection.closeSync();
  instance.closeSync();
}
