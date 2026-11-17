// Builds a new Word document (.docx) from headings, paragraphs, PNG images, and tables. A
// direct OOXML writer (D88): a .docx is a ZIP of a few XML parts, the project already reads
// that XML itself (D17), and this needs only four kinds of block. It only ever creates a
// file; editing an existing document stays a non-goal.

import type { Theme } from "../contracts/index.ts";
import { orientedPageMillimetres } from "../engines/browser/index.ts";
import { pngSize } from "../shared/png-size.ts";
import { createZip } from "../shared/zip-writer.ts";
import {
  escapeXml,
  footerRelationshipId,
  imageRelationshipId,
  packageEntries,
  pictureNamespace,
  styleIds,
} from "./docx-parts.ts";

export type DocxBlock =
  | { kind: "heading"; text: string; startsPage?: boolean }
  | { kind: "paragraph"; text: string }
  /** `description` is the picture's alternative text. */
  | { kind: "image"; png: Buffer; description: string }
  | { kind: "table"; columns: string[]; cells: string[][]; numericColumns: boolean[] };

export interface DocxDocument {
  blocks: DocxBlock[];
  /** Page size and orientation, from the theme (DATA-15). */
  page: Theme["page"];
  fontFamily: string;
  /** Printed at the foot of every page, as in a PDF. */
  footer?: string | undefined;
}

/** Word measures the page in twips (1/20 pt) and pictures in EMU. */
const twipsPerMillimetre = 1440 / 25.4;
const emuPerMillimetre = 36_000;
const marginMillimetres = 20;
/** Kept free on a picture's page, so its heading and summary stay beside it. */
const roomForTextMillimetres = 55;

interface PageGeometry {
  widthMillimetres: number;
  heightMillimetres: number;
  landscape: boolean;
  contentWidth: number;
  contentHeight: number;
}

export function buildDocx(document: DocxDocument): Buffer {
  const page = pageGeometry(document.page);
  const images: Buffer[] = [];
  const blocks = document.blocks.map((block) => blockXml(block, page, images)).join("");
  const bodyXml = blocks + sectionXml(page, Boolean(document.footer));
  const { fontFamily, footer } = document;
  return createZip(packageEntries({ bodyXml, images, fontFamily, footer }));
}

function pageGeometry(page: Theme["page"]): PageGeometry {
  const sheet = orientedPageMillimetres(page);
  return {
    widthMillimetres: sheet.width,
    heightMillimetres: sheet.height,
    landscape: page.orientation === "landscape",
    contentWidth: sheet.width - 2 * marginMillimetres,
    contentHeight: sheet.height - 2 * marginMillimetres,
  };
}

function blockXml(block: DocxBlock, page: PageGeometry, images: Buffer[]): string {
  switch (block.kind) {
    case "heading":
      return headingXml(block.text, block.startsPage === true);
    case "paragraph":
      return `<w:p>${runXml(block.text)}</w:p>`;
    case "image":
      images.push(block.png);
      return imageXml(block.png, block.description, images.length - 1, page);
    case "table":
      return tableXml(block, page);
  }
}

function headingXml(text: string, startsPage: boolean): string {
  const pageBreak = startsPage ? "<w:pageBreakBefore/>" : "";
  return `<w:p><w:pPr><w:pStyle w:val="${styleIds.heading}"/>${pageBreak}</w:pPr>${runXml(text)}</w:p>`;
}

/** One run of text. A line break in the text becomes a line break in the paragraph. */
function runXml(text: string, bold = false): string {
  const properties = bold ? "<w:rPr><w:b/></w:rPr>" : "";
  const lines = text
    .split(/\r?\n/)
    .map((line) => `<w:t xml:space="preserve">${escapeXml(line)}</w:t>`);
  return `<w:r>${properties}${lines.join("<w:br/>")}</w:r>`;
}

/** The picture at the widest size that fits the page with room left for its text. */
function imageXml(png: Buffer, description: string, index: number, page: PageGeometry): string {
  const pixels = pngSize(png);
  const millimetresPerPixel = Math.min(
    page.contentWidth / pixels.width,
    (page.contentHeight - roomForTextMillimetres) / pixels.height,
  );
  const width = Math.round(pixels.width * millimetresPerPixel * emuPerMillimetre);
  const height = Math.round(pixels.height * millimetresPerPixel * emuPerMillimetre);
  const id = index + 1;
  const extent = `cx="${width}" cy="${height}"`;
  const picture = [
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="image${id}.png"/><pic:cNvPicPr/></pic:nvPicPr>`,
    `<pic:blipFill><a:blip r:embed="${imageRelationshipId(index)}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`,
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext ${extent}/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`,
  ].join("");
  const inline = [
    `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent ${extent}/>`,
    `<wp:docPr id="${id}" name="Picture ${id}" descr="${escapeXml(description)}"/>`,
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>',
    `<a:graphic><a:graphicData uri="${pictureNamespace}">${picture}</a:graphicData></a:graphic></wp:inline>`,
  ].join("");
  // keepNext holds the picture on the same page as the summary under it.
  return `<w:p><w:pPr><w:keepNext/><w:jc w:val="center"/></w:pPr><w:r><w:drawing>${inline}</w:drawing></w:r></w:p>`;
}

const tableBorders = ["top", "left", "bottom", "right", "insideH", "insideV"]
  .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`)
  .join("");

/** The header row repeats on every page the table runs over. */
function tableXml(table: Extract<DocxBlock, { kind: "table" }>, page: PageGeometry): string {
  const columnCount = Math.max(table.columns.length, 1);
  const columnWidth = Math.floor((page.contentWidth * twipsPerMillimetre) / columnCount);
  const grid = `<w:gridCol w:w="${columnWidth}"/>`.repeat(columnCount);
  const cell = (text: string, column: number, isHeader: boolean) => {
    const alignment = table.numericColumns[column] && !isHeader ? '<w:jc w:val="right"/>' : "";
    return `<w:tc><w:tcPr><w:tcW w:w="${columnWidth}" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:pStyle w:val="${styleIds.tableCell}"/>${alignment}</w:pPr>${runXml(text, isHeader)}</w:p></w:tc>`;
  };
  const header = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${table.columns.map((name, column) => cell(name, column, true)).join("")}</w:tr>`;
  const rows = table.cells.map(
    (cells) => `<w:tr>${cells.map((text, column) => cell(text, column, false)).join("")}</w:tr>`,
  );
  const properties = `<w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${tableBorders}</w:tblBorders></w:tblPr>`;
  // Word needs a paragraph after a table that ends the document.
  return `<w:tbl>${properties}<w:tblGrid>${grid}</w:tblGrid>${header}${rows.join("")}</w:tbl><w:p/>`;
}

function sectionXml(page: PageGeometry, hasFooter: boolean): string {
  const twips = (millimetres: number) => Math.round(millimetres * twipsPerMillimetre);
  const footer = hasFooter
    ? `<w:footerReference w:type="default" r:id="${footerRelationshipId}"/>`
    : "";
  const orientation = page.landscape ? ' w:orient="landscape"' : "";
  const margin = twips(marginMillimetres);
  return [
    `<w:sectPr>${footer}`,
    `<w:pgSz w:w="${twips(page.widthMillimetres)}" w:h="${twips(page.heightMillimetres)}"${orientation}/>`,
    `<w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="${twips(10)}" w:footer="${twips(10)}" w:gutter="0"/>`,
    "</w:sectPr>",
  ].join("");
}
