// The pdf part's public face: turn a validated Vega-Lite spec and its rows into a PDF, PNG,
// or SVG file (DATA-13), several charts into one PDF with a page each, a PNG preview for the
// chart self-check, a print-resolution PNG for a Word document, a multi-chart report, or a
// row set into a paginated PDF table.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Page } from "playwright-core";
import type {
  ChartPage,
  ChartPagesRequest,
  ChartRenderRequest,
  ChartRenderResult,
  Row,
  TableRenderRequest,
  Theme,
} from "../../contracts/index.ts";
import { BrowserSession } from "./browser-session.ts";
import { replaceConfigFont, resolveFontFamily } from "./fonts.ts";
import type { BlockedRequest, BlockedRequestLogger } from "./offline.ts";
import {
  addTable,
  addTextBlock,
  drawChart,
  exportPng,
  exportSvg,
  setTextFont,
} from "./page-calls.ts";
import { type LoadedDecorations, loadDecorations } from "./page-decorations.ts";
import { fitSpecToArea, pdfOptions, printableArea } from "./page-layout.ts";
import { pdfPageCount } from "./pdf-pages.ts";
import { composeChartPages, composeReport, type ReportBlock } from "./report.ts";

/** PNG and SVG exports use one fixed scale, so the same chart is the same file on every run. */
export const exportScale = 2;
const previewScale = 1;
/** A chart placed in a document: about 300 dots per inch at the width of a page. */
const printImageScale = 3;

/** PNG, SVG, and preview charts with no size of their own get this one, in CSS pixels. */
const imageArea = { width: 720, height: 440 };

/** The name the harness gives the rows; the spec's top-level data always points at it. */
export const chartDataName = "table";

export interface ChartRendererOptions {
  /** About 60 s (D30). */
  idleMilliseconds: number;
  /** Receives every blocked browser request (DATA-14). Defaults to an in-memory list. */
  logBlocked?: BlockedRequestLogger;
  extraLaunchArguments?: string[];
}

export interface ChartRenderer {
  renderChart(request: ChartRenderRequest, signal?: AbortSignal): Promise<ChartRenderResult>;
  /** Several charts in one portrait PDF, a page each, each with its summary under it. */
  renderChartPages(request: ChartPagesRequest, signal?: AbortSignal): Promise<ChartRenderResult>;
  /** A small PNG for the chart self-check (DATA-18). Nothing is written to disk. */
  renderPreview(
    spec: Record<string, unknown>,
    rows: Row[],
    theme: Theme,
    signal?: AbortSignal,
  ): Promise<Buffer>;
  /** The chart as PNG bytes at print resolution, for embedding in a document. Nothing is written. */
  renderChartImage(
    spec: Record<string, unknown>,
    rows: Row[],
    theme: Theme,
    signal?: AbortSignal,
  ): Promise<{ png: Buffer; notes: string[] }>;
  /** A table of text cells as a PDF on the theme's page, header repeated on every page. */
  renderTable(request: TableRenderRequest, signal?: AbortSignal): Promise<ChartRenderResult>;
  /** Several charts and text blocks in one PDF (DATA-19). */
  renderReport(
    blocks: ReportBlock[],
    theme: Theme,
    outputPath: string,
    signal?: AbortSignal,
  ): Promise<ChartRenderResult>;
  /** Closes the browser now. Call on every exit path. */
  close(): Promise<void>;
  /** Requests blocked so far, when no logger was given. */
  readonly blockedRequests: readonly BlockedRequest[];
  readonly session: BrowserSession;
}

export function createChartRenderer(options: ChartRendererOptions): ChartRenderer {
  const blockedRequests: BlockedRequest[] = [];
  const session = new BrowserSession({
    idleMilliseconds: options.idleMilliseconds,
    logBlocked: options.logBlocked ?? ((request) => blockedRequests.push(request)),
    extraLaunchArguments: options.extraLaunchArguments,
  });

  return {
    blockedRequests,
    session,
    close: () => session.close(),

    async renderChart(request, signal) {
      const decorations = await loadDecorations(request.theme);
      const output = await session.withRenderPage(async (page) => {
        const pageTheme = await resolvePageTheme(page, request.theme);
        if (request.format !== "pdf") return exportImage(page, request, pageTheme);
        const chart = { spec: request.spec, rows: request.rows, summary: request.summary };
        return printChartPages(page, [chart], pageTheme, decorations);
      }, signal);
      return writeOutput(request.outputPath, output.bytes, [...decorations.notes, ...output.notes]);
    },

    async renderChartPages(request, signal) {
      // Several charts always print portrait, a page each, whatever the theme's orientation.
      const theme: Theme = {
        ...request.theme,
        page: { ...request.theme.page, orientation: "portrait" },
      };
      const decorations = await loadDecorations(theme);
      const output = await session.withRenderPage(async (page) => {
        const pageTheme = await resolvePageTheme(page, theme);
        return printChartPages(page, request.charts, pageTheme, decorations);
      }, signal);
      return writeOutput(request.outputPath, output.bytes, [...decorations.notes, ...output.notes]);
    },

    renderPreview(spec, rows, theme, signal) {
      return session.withRenderPage(async (page) => {
        const pageTheme = await resolvePageTheme(page, theme);
        const image = await drawImage(page, { spec, rows }, pageTheme);
        return exportPng(page, image.viewId, previewScale);
      }, signal);
    },

    renderChartImage(spec, rows, theme, signal) {
      return session.withRenderPage(async (page) => {
        const pageTheme = await resolvePageTheme(page, theme);
        const image = await drawImage(page, { spec, rows }, pageTheme);
        return { png: await exportPng(page, image.viewId, printImageScale), notes: image.notes };
      }, signal);
    },

    async renderTable(request, signal) {
      const decorations = await loadDecorations(request.theme);
      const output = await session.withRenderPage(async (page) => {
        const pageTheme = await resolvePageTheme(page, request.theme);
        await setTextFont(page, pageTheme.theme.fontFamily);
        if (request.title) await addTextBlock(page, "heading", request.title);
        await addTable(page, request.columns, request.cells, request.numericColumns);
        const bytes = await page.pdf(pdfOptions(pageTheme.theme, decorations));
        return { bytes, notes: pageTheme.notes };
      }, signal);
      return writeOutput(request.outputPath, output.bytes, [...decorations.notes, ...output.notes]);
    },

    async renderReport(blocks, theme, outputPath, signal) {
      const decorations = await loadDecorations(theme);
      const output = await session.withRenderPage(async (page) => {
        const pageTheme = await resolvePageTheme(page, theme);
        const area = printableArea(theme.page, decorations);
        const warnings = await composeReport(page, blocks, area, pageTheme.prepare);
        const bytes = await page.pdf(pdfOptions(pageTheme.theme, decorations));
        return { bytes, notes: [...pageTheme.notes, ...warnings] };
      }, signal);
      return writeOutput(outputPath, output.bytes, [...decorations.notes, ...output.notes]);
    },
  };
}

/** The theme as this machine can draw it: a missing font replaced by the system font. */
interface PageTheme {
  theme: Theme;
  notes: string[];
  /** Points a spec at the harness's rows and at the font actually used. */
  prepare(spec: Record<string, unknown>): Record<string, unknown>;
}

async function resolvePageTheme(page: Page, theme: Theme): Promise<PageTheme> {
  const font = await resolveFontFamily(page, theme.fontFamily);
  return {
    theme: { ...theme, fontFamily: font.fontFamily },
    notes: font.note ? [font.note] : [],
    prepare: (spec) => withHarnessData(replaceConfigFont(spec, theme.fontFamily, font.fontFamily)),
  };
}

/** Rows are attached by the harness under one name; whatever data the spec named is replaced. */
export function withHarnessData(spec: Record<string, unknown>): Record<string, unknown> {
  const { datasets: _ignored, ...rest } = spec;
  return { ...rest, data: { name: chartDataName } };
}

interface RenderedOutput {
  bytes: Buffer | string;
  notes: string[];
}

/** PDF for one chart or several: a printed page per chart, each with its summary under it. */
async function printChartPages(
  page: Page,
  charts: ChartPage[],
  pageTheme: PageTheme,
  decorations: LoadedDecorations,
): Promise<RenderedOutput> {
  await setTextFont(page, pageTheme.theme.fontFamily);
  const area = printableArea(pageTheme.theme.page, decorations);
  const warnings = await composeChartPages(page, charts, area, pageTheme.prepare);
  const bytes = await page.pdf(pdfOptions(pageTheme.theme, decorations));
  return { bytes, notes: [...pageTheme.notes, ...warnings] };
}

/** Draws a chart at the fixed image size, ready for a PNG or SVG export. */
async function drawImage(
  page: Page,
  chart: Pick<ChartPage, "spec" | "rows">,
  pageTheme: PageTheme,
): Promise<{ viewId: number; notes: string[] }> {
  const spec = fitSpecToArea(pageTheme.prepare(chart.spec), imageArea, chart.rows);
  const drawn = await drawChart(page, spec, chart.rows);
  return { viewId: drawn.viewId, notes: [...pageTheme.notes, ...drawn.warnings] };
}

async function exportImage(
  page: Page,
  request: ChartRenderRequest,
  pageTheme: PageTheme,
): Promise<RenderedOutput> {
  const { viewId, notes } = await drawImage(page, request, pageTheme);
  if (request.format === "png") {
    return { bytes: await exportPng(page, viewId, exportScale), notes };
  }
  return { bytes: await exportSvg(page, viewId), notes };
}

/** Never overwrites (D28): the caller picks a free name, and `wx` makes a race fail loudly. */
async function writeOutput(
  path: string,
  bytes: Buffer | string,
  notes: string[],
): Promise<ChartRenderResult> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "wx" });
  const sizeBytes = typeof bytes === "string" ? Buffer.byteLength(bytes) : bytes.length;
  const result: ChartRenderResult = { path, sizeBytes };
  if (Buffer.isBuffer(bytes) && path.toLowerCase().endsWith(".pdf")) {
    result.pageCount = pdfPageCount(bytes);
  }
  if (notes.length > 0) result.notes = notes;
  return result;
}
