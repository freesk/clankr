// Opens one index file as its own DuckDB instance (D91). It is never the locked `query_sql`
// engine: that one lives in memory with file access limited to the inspected data files, so
// model-written SQL has no way to this file. Only SQL written in this folder runs here.
//
// DuckDB is loaded on first use (CLAUDE.md rule 7). Files are created user-only (SEC-5).

import { chmod } from "node:fs/promises";
import { dirname } from "node:path";
import type { DuckDBConnection } from "@duckdb/node-api";
import { loadDuckDb } from "../engines/duckdb/load-duckdb.ts";
import { ensurePrivateDirectory, privateFileMode } from "../storage/index.ts";
import { writeAheadLogOf } from "./index-location.ts";

export type IndexAccess = "read" | "write";

export interface IndexDatabase {
  readonly connection: DuckDBConnection;
  /** Sets the index file and its write-ahead log to user-only. DuckDB creates them wider. */
  makePrivate(): Promise<void>;
  close(): Promise<void>;
}

/** No extension is ever installed or loaded; cosine similarity is built into DuckDB. */
const instanceOptions: Record<string, string> = {
  autoinstall_known_extensions: "false",
  autoload_known_extensions: "false",
  allow_community_extensions: "false",
  allow_unsigned_extensions: "false",
};

/**
 * "read" opens the file read-only, which writes nothing beside it, so an `--ephemeral`
 * session can search. "write" creates the file and its directory when missing.
 */
export async function openIndexDatabase(
  indexFile: string,
  access: IndexAccess,
): Promise<IndexDatabase> {
  const { DuckDBInstance } = await loadDuckDb();
  if (access === "write") await ensurePrivateDirectory(dirname(indexFile));
  const options =
    access === "read" ? { ...instanceOptions, access_mode: "READ_ONLY" } : instanceOptions;
  const instance = await DuckDBInstance.create(indexFile, options);
  const connection = await instance.connect();
  const makePrivate = async () => {
    if (access === "read") return;
    await chmodIfPresent(indexFile);
    await chmodIfPresent(writeAheadLogOf(indexFile));
  };
  await makePrivate();
  return {
    connection,
    makePrivate,
    async close() {
      connection.closeSync();
      instance.closeSync();
      await makePrivate();
    },
  };
}

/** True when DuckDB refused to open the file because another process holds it. */
export function isLockConflict(error: unknown): boolean {
  return error instanceof Error && /could not set lock|conflicting lock/i.test(error.message);
}

async function chmodIfPresent(path: string): Promise<void> {
  try {
    await chmod(path, privateFileMode);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
