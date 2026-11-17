// Turning DuckDB values into JSON row values for stored row sets (D16).
// DuckDB's own JSON converter writes BIGINT and DECIMAL as strings, which would make
// counts and sums text in every chart and transform. Numbers stay numbers here unless
// they cannot be represented exactly.

import type { DuckDBValueConverter, Json } from "@duckdb/node-api";
import type { JsonValue, Row } from "../../contracts/index.ts";
import type { DuckDbModule } from "./load-duckdb.ts";

export function createRowValueConverter(duckdb: DuckDbModule): DuckDBValueConverter<Json> {
  const { DuckDBTypeId, JsonDuckDBValueConverter } = duckdb;
  const integerTypes = new Set([
    DuckDBTypeId.BIGINT,
    DuckDBTypeId.UBIGINT,
    DuckDBTypeId.HUGEINT,
    DuckDBTypeId.UHUGEINT,
  ]);

  const converter: DuckDBValueConverter<Json> = (value, type, self) => {
    if (value === null) return null;
    if (integerTypes.has(type.typeId) && typeof value === "bigint") return integerToJson(value);
    if (type.typeId === DuckDBTypeId.DECIMAL && value instanceof duckdb.DuckDBDecimalValue) {
      return value.toDouble();
    }
    return JsonDuckDBValueConverter(value, type, self);
  };
  return converter;
}

function integerToJson(value: bigint): number | string {
  const asNumber = Number(value);
  return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
}

/** Zips column names with one converted row. Duplicate names keep the first value. */
export function rowFromValues(columnNames: readonly string[], values: readonly Json[]): Row {
  const row: Row = {};
  columnNames.forEach((name, index) => {
    if (!(name in row)) row[name] = (values[index] ?? null) as JsonValue;
  });
  return row;
}
