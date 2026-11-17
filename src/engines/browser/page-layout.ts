// The printed page (DATA-15, pdf's share): page size and orientation, margins, the logo in the
// header and the footer text, and sizing a chart and its summary so each stays on one page.

import type { Page } from "playwright-core";
import type { Row, Theme } from "../../contracts/index.ts";
import { isPlainObject } from "../../shared/index.ts";

type PDFOptions = NonNullable<Parameters<Page["pdf"]>[0]>;

const cssPixelsPerMillimetre = 96 / 25.4;

const pageSizeMillimetres: Record<Theme["page"]["size"], { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  Letter: { width: 215.9, height: 279.4 },
};

const sideMarginMillimetres = 12;
const plainMarginMillimetres = 12;
const headerMarginMillimetres = 22;
const footerMarginMillimetres = 16;

export interface PageDecorations {
  /** The theme logo as a data URL, already read from disk. */
  logoDataUrl?: string;
  footer?: string;
}

interface Margins {
  top: number;
  bottom: number;
  side: number;
}

function marginsFor(decorations: PageDecorations): Margins {
  return {
    top: decorations.logoDataUrl ? headerMarginMillimetres : plainMarginMillimetres,
    bottom: decorations.footer ? footerMarginMillimetres : plainMarginMillimetres,
    side: sideMarginMillimetres,
  };
}

function orientedPageMillimetres(page: Theme["page"]): { width: number; height: number } {
  const { width, height } = pageSizeMillimetres[page.size];
  return page.orientation === "landscape" ? { width: height, height: width } : { width, height };
}

/** The printable area in CSS pixels, which is what Vega sizes charts in. */
export function printableArea(
  page: Theme["page"],
  decorations: PageDecorations,
): { width: number; height: number } {
  const sheet = orientedPageMillimetres(page);
  const margins = marginsFor(decorations);
  const width = sheet.width - 2 * margins.side;
  const height = sheet.height - margins.top - margins.bottom;
  // Leave a little room so rounding never pushes the chart onto a second page.
  return {
    width: Math.floor(width * cssPixelsPerMillimetre) - 8,
    height: Math.floor(height * cssPixelsPerMillimetre) - 8,
  };
}

/** Summary text is 13 px; an average character is under 7 px wide, a line about 19 px high. */
const summaryCharacterWidth = 7;
const summaryLineHeight = 19;
/** The gap between chart and summary, plus slack so the page never spills over. */
const summaryGap = 24;

/**
 * The part of the area left for the chart once its summary is printed underneath. The line
 * count is estimated from the text length, generously, since a spill would add a page.
 */
export function areaAboveSummary(
  area: { width: number; height: number },
  summary: string | undefined,
): { width: number; height: number } {
  if (!summary) return area;
  const charactersPerLine = Math.max(20, Math.floor(area.width / summaryCharacterWidth));
  const lines = Math.ceil(summary.length / charactersPerLine);
  return { width: area.width, height: area.height - lines * summaryLineHeight - summaryGap };
}

const compositionKeys = ["hconcat", "vconcat", "concat", "facet", "repeat"];

/**
 * A single view with no size of its own is fitted to the area. Facet panels with no size of
 * their own share it (see sizeFacetPanels). Other composed views keep their sizes; for PDF the
 * finished drawing is then scaled to the page (fitDrawingToArea).
 */
export function fitSpecToArea(
  spec: Record<string, unknown>,
  area: { width: number; height: number },
  rows: Row[] = [],
): Record<string, unknown> {
  if (isPlainObject(spec.facet)) return sizeFacetPanels(spec, area, rows);
  const isComposed = compositionKeys.some((key) => key in spec);
  if (isComposed || "width" in spec || "height" in spec) return spec;
  return {
    ...spec,
    width: area.width,
    height: area.height,
    autosize: { type: "fit", contains: "padding" },
  };
}

/** Room for the y axis and its title, and for the chart title and panel headers. */
const facetAxisRoom = 80;
const facetTitleRoom = 110;
/** Labels drawn past a line's last point need room to the right of each panel. */
const endLabelRoom = 120;
const defaultFacetSpacing = 20;

/**
 * Facet panels without a size are sized so the grid fills the area: Vega-Lite would draw each
 * panel at its default 200 x 200 px, leaving most of a page empty.
 */
function sizeFacetPanels(
  spec: Record<string, unknown>,
  area: { width: number; height: number },
  rows: Row[],
): Record<string, unknown> {
  const inner = spec.spec;
  if (!isPlainObject(inner) || "width" in inner || "height" in inner) return spec;
  const facet = spec.facet as Record<string, unknown>;
  const { columns, rows: panelRows } = facetGrid(facet, spec.columns, rows);
  const hasEndLabels = hasTextLayer(inner);
  const spacing = hasEndLabels ? endLabelRoom : defaultFacetSpacing;
  const labelRoom = hasEndLabels ? endLabelRoom : 0;
  const width = Math.floor(
    (area.width - facetAxisRoom - labelRoom - spacing * (columns - 1)) / columns,
  );
  const height = Math.floor((area.height - facetTitleRoom - 40 * (panelRows - 1)) / panelRows);
  return {
    ...spec,
    ...(hasEndLabels && spec.spacing === undefined ? { spacing } : {}),
    spec: { ...inner, width: Math.max(width, 120), height: Math.max(height, 120) },
  };
}

function facetGrid(
  facet: Record<string, unknown>,
  wrapColumns: unknown,
  rows: Row[],
): { columns: number; rows: number } {
  const distinct = (definition: unknown): number => {
    const field = isPlainObject(definition) ? definition.field : undefined;
    if (typeof field !== "string") return 1;
    return Math.max(1, new Set(rows.map((row) => JSON.stringify(row[field] ?? null))).size);
  };
  if (typeof facet.field === "string") {
    const count = distinct(facet);
    const columns = typeof wrapColumns === "number" ? Math.min(wrapColumns, count) : count;
    return { columns: Math.min(columns, 4), rows: Math.ceil(count / Math.min(columns, 4)) };
  }
  return { columns: Math.min(distinct(facet.column), 4), rows: Math.min(distinct(facet.row), 4) };
}

function hasTextLayer(view: Record<string, unknown>): boolean {
  if (!Array.isArray(view.layer)) return false;
  return view.layer.some((layer) => {
    if (!isPlainObject(layer)) return false;
    const mark = isPlainObject(layer.mark) ? layer.mark.type : layer.mark;
    return mark === "text";
  });
}

export function pdfOptions(theme: Theme, decorations: PageDecorations): PDFOptions {
  const margins = marginsFor(decorations);
  const hasDecorations = Boolean(decorations.logoDataUrl || decorations.footer);
  return {
    format: theme.page.size,
    landscape: theme.page.orientation === "landscape",
    printBackground: true,
    margin: {
      top: `${margins.top}mm`,
      bottom: `${margins.bottom}mm`,
      left: `${margins.side}mm`,
      right: `${margins.side}mm`,
    },
    displayHeaderFooter: hasDecorations,
    headerTemplate: headerTemplate(decorations.logoDataUrl),
    footerTemplate: footerTemplate(decorations.footer, theme.fontFamily),
  };
}

function headerTemplate(logoDataUrl: string | undefined): string {
  if (!logoDataUrl) return "<span></span>";
  return `<div style="width:100%;padding:0 ${sideMarginMillimetres}mm;"><img src="${logoDataUrl}" style="height:10mm;"></div>`;
}

function footerTemplate(footer: string | undefined, fontFamily: string): string {
  if (!footer) return "<span></span>";
  const style = `width:100%;padding:0 ${sideMarginMillimetres}mm;font-size:8px;color:#555;font-family:${escapeHtml(JSON.stringify(fontFamily))};display:flex;justify-content:space-between;`;
  return `<div style="${style}"><span>${escapeHtml(footer)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
}

/** The footer is user text placed into HTML, so it is escaped rather than trusted. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
