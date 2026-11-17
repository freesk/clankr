// Turns what the chart code passed to `render` into a spec the renderer can draw:
// row cap, external references, styling removed, harness data and theme applied, schema
// validation, the field check, then polish (axis formats, hidden legends; see spec-polish.ts). Every failure is a ToolError the model can act on.

import { type Row, type Theme, ToolError } from "../contracts/index.ts";
import { withHarnessData } from "../engines/browser/index.ts";
import { externalReferenceMessage, findExternalReference } from "./external-references.ts";
import { findMissingField } from "./field-check.ts";
import { validateSpec } from "./schema-validation.ts";
import { polishSpec } from "./spec-polish.ts";
import { cloneSpec, isPlainObject, type SpecObject } from "./spec-tree.ts";
import { applyTheme, stripStyling } from "./styling.ts";

export interface PreparedChart {
  spec: SpecObject;
  /** Short notes for the model, such as which styling was removed. */
  notes: string[];
}

export async function prepareChartSpec(
  spec: unknown,
  rows: Row[],
  options: { theme: Theme; rowCap: number },
): Promise<PreparedChart> {
  // Row cap first (DATA-17): nothing else is worth checking on a chart of raw rows.
  if (rows.length > options.rowCap) throw new ToolError(rowCapMessage(rows.length, options.rowCap));
  if (!isPlainObject(spec)) {
    throw new ToolError(
      'render(spec, rows): spec must be an object such as { mark: "bar", encoding: {...} }.',
    );
  }
  const working = cloneSpec(spec);
  const reference = findExternalReference(working);
  if (reference) throw new ToolError(externalReferenceMessage(reference));

  const removedStyling = stripStyling(working);
  const themed = applyTheme(withHarnessData(working), options.theme);

  const schemaMessages = await validateSpec(themed);
  if (schemaMessages.length > 0) {
    throw new ToolError(`The Vega-Lite spec is invalid:\n- ${schemaMessages.join("\n- ")}`);
  }
  const missingField = findMissingField(themed, rows);
  if (missingField) throw new ToolError(missingField);
  polishSpec(themed, rows);

  const notes =
    removedStyling.length > 0
      ? [`Removed styling (the theme sets it): ${removedStyling.slice(0, 5).join(", ")}.`]
      : [];
  return { spec: themed, notes };
}

/** A captured chart after preparation: what the renderer and the companion files get. */
export interface PreparedChartPage {
  spec: SpecObject;
  rows: Row[];
  summary?: string;
}

/**
 * Every chart of one call through the same pipeline. With several charts, errors and notes
 * name the chart ("chart 2: ...") so the model knows which render call to fix.
 */
export async function prepareCharts(
  charts: { spec: unknown; rows: Row[]; summary?: string }[],
  options: { theme: Theme; rowCap: number },
): Promise<{ charts: PreparedChartPage[]; notes: string[] }> {
  const prepared: PreparedChartPage[] = [];
  const notes: string[] = [];
  const several = charts.length > 1;
  for (const [index, chart] of charts.entries()) {
    const result = await prepareChartSpec(chart.spec, chart.rows, options).catch(
      (error: unknown) => {
        throw several ? namingChart(error, index + 1) : error;
      },
    );
    notes.push(...result.notes.map((note) => (several ? `chart ${index + 1}: ${note}` : note)));
    const page: PreparedChartPage = { spec: result.spec, rows: chart.rows };
    if (chart.summary) page.summary = chart.summary;
    prepared.push(page);
  }
  return { charts: prepared, notes };
}

/** "chart 2: <message>", so the model knows which render call to fix. Other errors pass through. */
export function namingChart(error: unknown, chartNumber: number): unknown {
  if (!(error instanceof ToolError)) return error;
  return new ToolError(`chart ${chartNumber}: ${error.message}`);
}

export function rowCapMessage(rowCount: number, rowCap: number): string {
  return `The chart got ${rowCount} rows; the limit is ${rowCap}. Aggregate first with query_sql (GROUP BY), then chart the smaller result.`;
}
