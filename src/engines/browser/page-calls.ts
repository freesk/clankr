// Node-side wrappers for the functions the render page exposes as `window.vix`. The spec,
// rows, and text cross into the page only as evaluate arguments, which Playwright serialises
// as data; nothing is ever concatenated into script (DATA-12).

import type { Page } from "playwright-core";
import type { Row } from "../../contracts/index.ts";

interface RenderPageApi {
  renderChart(
    spec: Record<string, unknown>,
    rows: Row[],
  ): Promise<{ viewId: number; warnings: string[] }>;
  addText(kind: TextBlockKind, text: string): void;
  exportPng(viewId: number, scale: number): Promise<string>;
  exportSvg(viewId: number): Promise<string>;
  isFontInstalled(family: string): boolean;
}

export type TextBlockKind = "heading" | "paragraph";

export interface DrawnChart {
  viewId: number;
  /** Vega-Lite and Vega warnings, such as a field that is not in the data. */
  warnings: string[];
}

/** Raised when Vega-Lite or Vega rejects a spec in the page. The message is safe to show the model. */
export class ChartDrawError extends Error {
  override readonly name = "ChartDrawError";
}

// The page's global. The callbacks below are serialised and run in the page, where it exists.
declare const vix: RenderPageApi;

export async function drawChart(
  page: Page,
  spec: Record<string, unknown>,
  rows: Row[],
): Promise<DrawnChart> {
  // Typed as unknown on the way in: Playwright's deep serialisation types cannot follow JsonValue.
  const data: [unknown, unknown] = [spec, rows];
  try {
    return await page.evaluate(
      ([pageSpec, pageRows]) =>
        vix.renderChart(pageSpec as Record<string, unknown>, pageRows as Row[]),
      data,
    );
  } catch (error) {
    throw new ChartDrawError(firstLineOfPageError(error));
  }
}

export async function addTextBlock(page: Page, kind: TextBlockKind, text: string): Promise<void> {
  await page.evaluate(([blockKind, blockText]) => vix.addText(blockKind, blockText), [
    kind,
    text,
  ] as const);
}

export async function exportPng(page: Page, viewId: number, scale: number): Promise<Buffer> {
  const base64 = await page.evaluate(([id, pngScale]) => vix.exportPng(id, pngScale), [
    viewId,
    scale,
  ] as const);
  return Buffer.from(base64, "base64");
}

export function exportSvg(page: Page, viewId: number): Promise<string> {
  return page.evaluate((id) => vix.exportSvg(id), viewId);
}

export function isFontInstalled(page: Page, family: string): Promise<boolean> {
  return page.evaluate((fontFamily) => vix.isFontInstalled(fontFamily), family);
}

/** Playwright wraps page errors as "page.evaluate: Error: <message>\n    at ...". Keep the message. */
function firstLineOfPageError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const firstLine = text.split("\n")[0] ?? text;
  return firstLine.replace(/^page\.evaluate:\s*/, "").replace(/^Error:\s*/, "");
}
