// Test fixtures generated in code: workbooks through SheetJS, Word documents through a
// small zip writer. Test code only.

import { writeFile } from "node:fs/promises";
import * as XLSX from "xlsx";
import { createZip } from "../../../../shared/zip-writer.ts";

export interface FixtureSheet {
  name: string;
  rows: unknown[][];
}

/** Dates in `rows` must be local-time Dates (`new Date(2024, 0, 15)`), as SheetJS writes them. */
export async function writeWorkbook(
  path: string,
  sheets: FixtureSheet[],
  bookType: "xlsx" | "biff8",
): Promise<void> {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(sheet.rows, { cellDates: true }),
      sheet.name,
    );
  }
  await writeFile(path, XLSX.write(workbook, { type: "buffer", bookType }));
}

const wordNamespace = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

export function docxParagraph(text: string, styleId?: string): string {
  const properties = styleId ? `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` : "";
  return `<w:p>${properties}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

export function docxTable(rows: string[][]): string {
  const rowXml = rows.map(
    (cells) =>
      `<w:tr>${cells.map((cell) => `<w:tc><w:tcPr/>${docxParagraph(cell)}</w:tc>`).join("")}</w:tr>`,
  );
  return `<w:tbl><w:tblPr/>${rowXml.join("")}</w:tbl>`;
}

const headingStyles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${wordNamespace}>
  <w:style w:type="paragraph" w:styleId="Titel"><w:name w:val="Title"/></w:style>
  <w:style w:type="paragraph" w:styleId="berschrift1"><w:name w:val="heading 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
</w:styles>`;

/** A minimal .docx. Heading style ids: "Titel" (title), "berschrift1" (h1), "Heading2" (h2). */
export async function writeDocx(path: string, bodyXml: string): Promise<void> {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${wordNamespace}><w:body>${bodyXml}<w:sectPr/></w:body></w:document>`;
  await writeFile(
    path,
    createZip([
      zipEntry("[Content_Types].xml", "<Types/>"),
      zipEntry("word/document.xml", document),
      zipEntry("word/styles.xml", headingStyles),
    ]),
  );
}

function escapeXml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Deflated, as Word writes its parts, so the reader's inflate path is exercised. */
function zipEntry(name: string, text: string) {
  return { name, data: Buffer.from(text, "utf8"), compress: true };
}
