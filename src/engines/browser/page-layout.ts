// The printed page (DATA-15, pdf's share): page size and orientation, margins, the logo in the
// header and the footer text, and sizing a chart so a single-chart PDF stays on one page.

import type { Page } from "playwright-core";
import type { Theme } from "../../contracts/index.ts";

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

const compositionKeys = ["hconcat", "vconcat", "concat", "facet", "repeat"];

/**
 * A single view with no size of its own is fitted to the area. Composed views keep their
 * sizes; the page stylesheet scales their SVG down if it is too wide.
 */
export function fitSpecToArea(
  spec: Record<string, unknown>,
  area: { width: number; height: number },
): Record<string, unknown> {
  const isComposed = compositionKeys.some((key) => key in spec);
  if (isComposed || "width" in spec || "height" in spec) return spec;
  return {
    ...spec,
    width: area.width,
    height: area.height,
    autosize: { type: "fit", contains: "padding" },
  };
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
