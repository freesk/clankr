// A .docx fixture with headings, paragraphs, and tables (S7, S9), written as raw
// WordprocessingML inside a ZIP. The ZIP has fixed timestamps, so the bytes are the
// same on every run.

import { z } from "zod";
import { createZip } from "../../../src/shared/zip-writer.ts";
import { boardReport } from "../datasets.ts";

export const docxOptions = z.object({ document: z.enum(["board-report"]) });

interface DocxTable {
  caption: string;
  header: string[];
  rows: string[][];
}

interface DocxContent {
  title: string;
  paragraphs: string[];
  tables: DocxTable[];
}

/** One piece of a document body, in reading order. */
export type DocxBlock =
  | { kind: "title"; text: string }
  | { kind: "heading"; level: 1 | 2; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "table"; header: string[]; rows: string[][] };

const documents: Record<z.infer<typeof docxOptions>["document"], DocxContent> = {
  "board-report": boardReport,
};

export function renderDocx(options: z.infer<typeof docxOptions>): Buffer {
  return renderDocxBlocks(blocksOf(documents[options.document]));
}

/** The eval documents use plain paragraphs only: no heading styles. */
function blocksOf(content: DocxContent): DocxBlock[] {
  return [
    { kind: "paragraph", text: content.title },
    ...content.paragraphs.map((text): DocxBlock => ({ kind: "paragraph", text })),
    ...content.tables.flatMap((table): DocxBlock[] => [
      { kind: "paragraph", text: table.caption },
      { kind: "table", header: table.header, rows: table.rows },
    ]),
  ];
}

export function renderDocxBlocks(blocks: DocxBlock[]): Buffer {
  return createZip([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypesXml) },
    { name: "_rels/.rels", data: Buffer.from(packageRelationshipsXml) },
    { name: "word/_rels/document.xml.rels", data: Buffer.from(documentRelationshipsXml) },
    { name: "word/document.xml", data: Buffer.from(documentXml(blocks)) },
    { name: "word/styles.xml", data: Buffer.from(stylesXml) },
  ]);
}

function documentXml(blocks: DocxBlock[]): string {
  const body = blocks.map(blockXml).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${wordNamespace}><w:body>${body}</w:body></w:document>`;
}

function blockXml(block: DocxBlock): string {
  switch (block.kind) {
    case "title":
      return paragraph(block.text, "Title");
    case "heading":
      return paragraph(block.text, `Heading${block.level}`);
    case "paragraph":
      return paragraph(block.text);
    case "table":
      return tableXml([block.header, ...block.rows]);
  }
}

function paragraph(text: string, styleId?: string): string {
  const properties = styleId ? `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` : "";
  return `<w:p>${properties}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function tableXml(rows: string[][]): string {
  const rowXml = rows.map(
    (cells) => `<w:tr>${cells.map((cell) => `<w:tc>${paragraph(cell)}</w:tc>`).join("")}</w:tr>`,
  );
  return `<w:tbl>${tableProperties}${rowXml.join("")}</w:tbl>`;
}

/** Single-line borders, so the tables are readable when a person opens the file in Word. */
const tableProperties = `<w:tblPr><w:tblBorders>${[
  "top",
  "left",
  "bottom",
  "right",
  "insideH",
  "insideV",
]
  .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`)
  .join("")}</w:tblBorders></w:tblPr>`;

function escapeXml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

const wordNamespace = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;

const packageRelationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const documentRelationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${wordNamespace}><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style></w:styles>`;
