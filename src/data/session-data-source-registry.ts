// The session's list of inspected data files (specs/inspect.md). It is also DuckDB's
// allow-list (DATA-7): the sql engine exposes exactly the tables registered here.

import type { DataSource, DataSourceRegistry } from "../contracts/index.ts";

export class SessionDataSourceRegistry implements DataSourceRegistry {
  private readonly sourcesByPath = new Map<string, DataSource>();

  /** Registering a path again replaces its earlier entry (the file was re-inspected). */
  register(source: DataSource): void {
    this.sourcesByPath.delete(source.realPath);
    this.sourcesByPath.set(source.realPath, source);
  }

  find(handleOrPath: string): DataSource | undefined {
    return (
      this.sourcesByPath.get(handleOrPath) ??
      this.list().find((source) => source.handle === handleOrPath)
    );
  }

  findByTable(sqlName: string): DataSource | undefined {
    const wanted = sqlName.toLowerCase();
    return this.list().find((source) =>
      source.tables.some((table) => table.sqlName.toLowerCase() === wanted),
    );
  }

  list(): DataSource[] {
    return [...this.sourcesByPath.values()];
  }
}
