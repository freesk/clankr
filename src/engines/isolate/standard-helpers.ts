// The standard helpers injected into every isolate: `data(handle)` reads a stored row set and
// `save(name, rows)` stores one. Each validates its arguments here, on the host, because the
// helper list is the isolate's whole attack surface (specs/sandbox.md).

import type {
  IsolateLimits,
  JsonValue,
  ResultStore,
  Row,
  StandardHelpersFactory,
} from "../../contracts/index.ts";
import { ToolError } from "../../contracts/index.ts";

/** Provenance tool name for row sets stored by `save`. */
export const saveProvenanceTool = "save";

const maxSaveNameLength = 80;

export const createStandardHelpers: StandardHelpersFactory = (results, limits) => ({
  data: (handle) => readRowSet(results, limits, handle),
  save: (name, rows) => saveRowSet(results, limits, name, rows),
});

async function readRowSet(
  results: ResultStore,
  limits: IsolateLimits,
  handle: JsonValue | undefined,
): Promise<Row[]> {
  if (typeof handle !== "string" || handle.length === 0) {
    throw new ToolError('data() takes a result handle, for example data("r12").');
  }
  const meta = await describeOrFail(results, handle);
  if (meta.kind !== "rows") {
    throw new ToolError(`${handle} holds text, not rows. data() reads row sets only.`);
  }
  if (meta.itemCount > limits.rowCap) {
    throw new ToolError(
      `${handle} has ${formatCount(meta.itemCount)} rows, more than the ${formatCount(limits.rowCap)} ` +
        "a script can read. Aggregate or filter with query_sql first.",
    );
  }
  const rows: Row[] = [];
  for await (const row of results.readRows(handle, limits.rowCap)) rows.push(row);
  return rows;
}

async function saveRowSet(
  results: ResultStore,
  limits: IsolateLimits,
  name: JsonValue | undefined,
  rows: JsonValue | undefined,
): Promise<string> {
  if (typeof name !== "string" || name.trim().length === 0 || name.length > maxSaveNameLength) {
    throw new ToolError(
      `save() takes a short name first, for example save("totals", rows). Names are at most ${maxSaveNameLength} characters.`,
    );
  }
  if (!isRowArray(rows)) {
    throw new ToolError("save() takes an array of plain objects as rows, for example [{ a: 1 }].");
  }
  if (rows.length > limits.rowCap) {
    throw new ToolError(
      `save() accepts at most ${formatCount(limits.rowCap)} rows; got ${formatCount(rows.length)}. ` +
        "Aggregate before saving.",
    );
  }
  return await results.putRows(rows, {
    tool: saveProvenanceTool,
    arguments: { name },
    label: name,
  });
}

async function describeOrFail(results: ResultStore, handle: string) {
  try {
    return await results.describe(handle);
  } catch {
    throw new ToolError(
      `No stored result is called ${handle}. Use a handle from an earlier result.`,
    );
  }
}

/** Rows are plain objects. Values are already JSON, because they crossed the boundary as JSON. */
export function isRowArray(value: JsonValue | undefined): value is Row[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "object" && item !== null && !Array.isArray(item))
  );
}

function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}
