// Fakes for this part's tests: a tiny stand-in for sandbox's isolate and standard helpers, and
// a renderer that writes a placeholder file. Not used by the harness itself.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  type ChartPagesRequest,
  type ChartRenderRequest,
  type ChartRenderResult,
  type IsolateHelper,
  type IsolateResult,
  type JsonValue,
  type ResultStore,
  type Row,
  type RunInIsolate,
  type StandardHelpersFactory,
  type TableRenderRequest,
  ToolError,
} from "../contracts/index.ts";

/**
 * Runs test-authored code as a plain function, with helpers that look synchronous to it, like
 * the real isolate. Only ToolError messages reach the "model", as in sandbox. Test code only:
 * this runs code with full host access, which is what the real isolate exists to prevent.
 */
export const fakeRunInIsolate: RunInIsolate = async (code, helpers) => {
  const pending: Promise<unknown>[] = [];
  const logs: string[] = [];
  const wrapped = Object.entries(helpers).map(([, helper]) => (...args: JsonValue[]) => {
    const result = helper(...args);
    if (result instanceof Promise) {
      pending.push(result);
      return undefined;
    }
    return result;
  });
  try {
    const console = { log: (...parts: unknown[]) => logs.push(parts.map(String).join(" ")) };
    const run = new Function("console", ...Object.keys(helpers), code);
    const value = run(console, ...wrapped) as JsonValue | undefined;
    await Promise.all(pending);
    return { ok: true, value, logs } satisfies IsolateResult;
  } catch (error) {
    const message = error instanceof ToolError ? error.message : "render() failed unexpectedly.";
    return { ok: false, error: message, logs };
  }
};

/** `data(handle)` over a preloaded map, since the fake cannot wait on the store synchronously. */
export function fakeStandardHelpers(preloaded: Map<string, Row[]>): StandardHelpersFactory {
  return (_results: ResultStore) => {
    const data: IsolateHelper = (handle) => {
      const rows = preloaded.get(String(handle));
      if (!rows) throw new ToolError(`Unknown handle ${String(handle)}`);
      return rows as JsonValue;
    };
    return { data };
  };
}

/** A real 1 x 1 PNG, so a document writer has an image whose header it can read. */
export const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=",
  "base64",
);

/** A renderer stand-in: records each request and writes a placeholder file. */
export function createFakeRenderer() {
  const requests: ChartRenderRequest[] = [];
  const pageRequests: ChartPagesRequest[] = [];
  const tableRequests: TableRenderRequest[] = [];
  const previews: Record<string, unknown>[] = [];
  const images: Record<string, unknown>[] = [];
  return {
    requests,
    pageRequests,
    tableRequests,
    previews,
    images,
    async renderChart(request: ChartRenderRequest): Promise<ChartRenderResult> {
      requests.push(request);
      return writePlaceholder(request.outputPath, 1);
    },
    async renderChartPages(request: ChartPagesRequest): Promise<ChartRenderResult> {
      pageRequests.push(request);
      return writePlaceholder(request.outputPath, request.charts.length);
    },
    async renderPreview(spec: Record<string, unknown>): Promise<Buffer> {
      previews.push(spec);
      return Buffer.from("png");
    },
    async renderChartImage(spec: Record<string, unknown>) {
      images.push(spec);
      return { png: onePixelPng, notes: [] as string[] };
    },
    async renderTable(request: TableRenderRequest): Promise<ChartRenderResult> {
      tableRequests.push(request);
      return writePlaceholder(request.outputPath, 1);
    },
  };
}

async function writePlaceholder(path: string, pageCount: number): Promise<ChartRenderResult> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "placeholder", { flag: "wx" });
  return path.endsWith(".pdf") ? { path, sizeBytes: 11, pageCount } : { path, sizeBytes: 11 };
}
