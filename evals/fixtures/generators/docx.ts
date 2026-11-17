// A .docx fixture with paragraphs and tables (S7, S9), written as raw
// WordprocessingML inside a ZIP.

import { z } from "zod";
import { boardReport } from "../datasets.ts";
import { createZip } from "./zip.ts";

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

const documents: Record<z.infer<typeof docxOptions>["document"], DocxContent> = {
  "board-report": boardReport,
};

export function renderDocx(options: z.infer<typeof docxOptions>): Buffer {
  const content = documents[options.document];
  return createZip([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypesXml) },
    { name: "_rels/.rels", data: Buffer.from(packageRelationshipsXml) },
    { name: "word/document.xml", data: Buffer.from(documentXml(content)) },
  ]);
}

function documentXml(content: DocxContent): string {
  const body = [
    paragraph(content.title),
    ...content.paragraphs.map(paragraph),
    ...content.tables.flatMap((table) => [paragraph(table.caption), tableXml(table)]),
  ].join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
}

function paragraph(text: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function tableXml(table: DocxTable): string {
  const rows = [table.header, ...table.rows].map(
    (cells) => `<w:tr>${cells.map((cell) => `<w:tc>${paragraph(cell)}</w:tc>`).join("")}</w:tr>`,
  );
  return `<w:tbl>${rows.join("")}</w:tbl>`;
}

function escapeXml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

const packageRelationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
