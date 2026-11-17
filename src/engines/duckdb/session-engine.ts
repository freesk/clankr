// One locked DuckDB instance per session, with every inspected table exposed as a view.
// A locked configuration cannot be extended, so when the registry changes the instance
// is rebuilt with the new file added (D38). It holds nothing worth keeping: inputs are
// views over files. The rebuild happens lazily, on the next query after a registration.

import type { DuckDBConnection } from "@duckdb/node-api";
import type {
  DataSource,
  DataSourceRegistry,
  ResultStore,
  ToolContext,
} from "../../contracts/index.ts";
import { type LockedDatabase, openLockedDatabase } from "./locked-database.ts";
import { readAllRows } from "./run-query.ts";
import { identifiersIn, quoteIdentifier, quoteLiteral } from "./sql-text.ts";
import { fileReadBy, readsExcel, type TableSourceInput, tableSourceSql } from "./table-source.ts";

export interface SessionEngineOptions {
  registry: DataSourceRegistry;
  results: ResultStore;
  scratchDirectory: string;
  memoryLimitMb: number;
}

export interface RegisteredTable {
  sqlName: string;
  source: DataSource;
  input: TableSourceInput;
}

export class SessionEngine {
  private database: LockedDatabase | undefined;
  private builtFingerprint: string | undefined;
  private building: Promise<DuckDBConnection> | undefined;
  private unreadable: string[] = [];

  private readonly options: SessionEngineOptions;

  constructor(options: SessionEngineOptions) {
    this.options = options;
  }

  /** The locked connection, rebuilt first if a file was registered since the last build. */
  async connection(): Promise<DuckDBConnection> {
    const fingerprint = registryFingerprint(this.options.registry);
    if (this.database && fingerprint === this.builtFingerprint) return this.database.connection;
    this.building ??= this.rebuild(fingerprint).finally(() => {
      this.building = undefined;
    });
    return this.building;
  }

  /** Every table the registry exposes, with what is needed to read it. */
  tables(): RegisteredTable[] {
    return this.options.registry.list().flatMap((source) =>
      source.tables.map((table) => ({
        sqlName: table.sqlName,
        source,
        input: {
          format: source.format,
          realPath: source.realPath,
          table,
          rowsFilePath: table.rowsHandle
            ? this.options.results.rowsFilePath?.(table.rowsHandle)
            : undefined,
        },
      })),
    );
  }

  /** Registered tables a SQL text names, by table name or by the file's path. */
  tablesNamedIn(sql: string): RegisteredTable[] {
    const identifiers = identifiersIn(sql);
    return this.tables().filter(
      (table) =>
        identifiers.has(table.sqlName.toLowerCase()) || sql.includes(table.source.realPath),
    );
  }

  /** Tables whose file could not be read at the last rebuild. */
  unreadableTables(): string[] {
    return [...this.unreadable];
  }

  async columnsOf(tableNames: string[]): Promise<string[]> {
    if (tableNames.length === 0) return [];
    const connection = await this.connection();
    const nameList = tableNames.map(quoteLiteral).join(", ");
    const rows = await readAllRows(
      connection,
      `SELECT table_name, column_name FROM duckdb_columns() WHERE table_name IN (${nameList}) ORDER BY table_name, column_index`,
    );
    const qualify = tableNames.length > 1;
    return rows.map((row) =>
      qualify ? `${row.table_name}.${row.column_name}` : String(row.column_name),
    );
  }

  close(): void {
    this.database?.close();
    this.database = undefined;
    this.builtFingerprint = undefined;
  }

  private async rebuild(fingerprint: string): Promise<DuckDBConnection> {
    this.close();
    const tables = this.tables().filter((table) => isReadable(table.input));
    const database = await openLockedDatabase({
      allowedFiles: [...new Set(tables.map((table) => fileReadBy(table.input)))],
      scratchDirectory: this.options.scratchDirectory,
      memoryLimitMb: this.options.memoryLimitMb,
      loadExcelReader: tables.some((table) => readsExcel(table.input)),
    });
    this.unreadable = [];
    for (const table of tables) {
      try {
        await database.connection.run(
          `CREATE VIEW ${quoteIdentifier(table.sqlName)} AS SELECT * FROM ${tableSourceSql(table.input)}`,
        );
      } catch {
        // The file changed or vanished since it was inspected. Other tables stay usable.
        this.unreadable.push(table.sqlName);
      }
    }
    this.database = database;
    this.builtFingerprint = fingerprint;
    return database.connection;
  }
}

/** A row set without a file on disk cannot be read by DuckDB (an in-memory result store). */
function isReadable(input: TableSourceInput): boolean {
  return !input.table.rowsHandle || input.rowsFilePath !== undefined;
}

function registryFingerprint(registry: DataSourceRegistry): string {
  return JSON.stringify(
    registry.list().map((source) => [source.realPath, source.format, source.tables]),
  );
}

const enginesByRegistry = new WeakMap<DataSourceRegistry, SessionEngine>();

/** The session's engine. Sessions are told apart by their data source registry. */
export function sessionEngineFor(context: ToolContext): SessionEngine {
  let engine = enginesByRegistry.get(context.dataSources);
  if (!engine) {
    engine = new SessionEngine({
      registry: context.dataSources,
      results: context.results,
      scratchDirectory: context.vixPaths.session.scratch,
      memoryLimitMb: context.config.data.sqlMemoryLimitMb,
    });
    enginesByRegistry.set(context.dataSources, engine);
  }
  return engine;
}

/** Called when a session ends, so the DuckDB instance is closed promptly. */
export function closeSessionEngine(registry: DataSourceRegistry): void {
  enginesByRegistry.get(registry)?.close();
  enginesByRegistry.delete(registry);
}
