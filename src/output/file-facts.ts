// The facts a tool result gives about a saved file, worded one way for charts and tables.

import type { ChartRenderResult } from "../contracts/index.ts";

export function formatFileSize(sizeBytes: number): string {
  return sizeBytes < 1024 ? `${sizeBytes} B` : `${Math.round(sizeBytes / 1024)} KB`;
}

/** "3 pages" for a written PDF; undefined for files that have no page count. */
export function pageCountText(written: ChartRenderResult): string | undefined {
  if (written.pageCount === undefined) return undefined;
  return `${written.pageCount} ${written.pageCount === 1 ? "page" : "pages"}`;
}
