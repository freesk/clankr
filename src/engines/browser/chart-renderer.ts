// The pdf part's public face: turn a validated Vega-Lite spec and its rows into a PDF, PNG,
// or SVG file (DATA-13), a PNG preview for the chart self-check, or a multi-chart report.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Page } from "playwright-core";
import type { ChartRenderRequest, ChartRenderResult, Row, Theme } from "../../contracts/index.ts";
import { BrowserSession } from "./browser-session.ts";
import { replaceConfigFont, resolveFontFamily } from "./fonts.ts";
import type { BlockedRequest, BlockedRequestLogger } from "./offline.ts";
import { drawChart, exportPng, exportSvg } from "./page-calls.ts";
import { type LoadedDecorations, loadDecorations } from "./page-decorations.ts";
import { fitSpecToArea, pdfOptions, printableArea } from "./page-layout.ts";
import { composeReport, type ReportBlock } from "./report.ts";

/** PNG and SVG exports use one fixed scale, so the same chart is the same file on every run. */
export const exportScale = 2;
const previewScale = 1;

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
  /** A small PNG for the chart self-check (DATA-18). Nothing is written to disk. */
  renderPreview(
    spec: Record<string, unknown>,
    rows: Row[],
    theme: Theme,
    signal?: AbortSignal,
  ): Promise<Buffer>;
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
        return exportChart(page, request, pageTheme, decorations);
      }, signal);
      return writeOutput(request.outputPath, output.bytes, [...decorations.notes, ...output.notes]);
    },

    renderPreview(spec, rows, theme, signal) {
      return session.withRenderPage(async (page) => {
        const pageTheme = await resolvePageTheme(page, theme);
        const drawn = await drawChart(
          page,
          fitSpecToArea(pageTheme.prepare(spec), imageArea),
          rows,
        );
        return exportPng(page, drawn.viewId, previewScale);
      }, signal);
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

async function exportChart(
  page: Page,
  request: ChartRenderRequest,
  pageTheme: PageTheme,
  decorations: LoadedDecorations,
): Promise<{ bytes: Buffer | string; notes: string[] }> {
  const area =
    request.format === "pdf" ? printableArea(request.theme.page, decorations) : imageArea;
  const drawn = await drawChart(
    page,
    fitSpecToArea(pageTheme.prepare(request.spec), area),
    request.rows,
  );
  const notes = [...pageTheme.notes, ...drawn.warnings];
  if (request.format === "png") {
    return { bytes: await exportPng(page, drawn.viewId, exportScale), notes };
  }
  if (request.format === "svg") return { bytes: await exportSvg(page, drawn.viewId), notes };
  return { bytes: await page.pdf(pdfOptions(pageTheme.theme, decorations)), notes };
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
  return notes.length > 0 ? { path, sizeBytes, notes } : { path, sizeBytes };
}
