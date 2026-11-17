// Test fixtures generated in code: workbooks through SheetJS, Word documents through a
// small zip writer. Test code only.

import { writeFile } from "node:fs/promises";
import { crc32, deflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";

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
    makeZip([
      { name: "[Content_Types].xml", text: "<Types/>" },
      { name: "word/document.xml", text: document },
      { name: "word/styles.xml", text: headingStyles },
    ]),
  );
}

function escapeXml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** A zip archive with deflated entries, enough for OOXML readers. */
export function makeZip(entries: { name: string; text: string }[]): Buffer {
  const localParts: Buffer[] = [];
  const directoryParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const data = Buffer.from(entry.text, "utf8");
    const compressed = deflateRawSync(data);
    const name = Buffer.from(entry.name, "utf8");
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    localParts.push(local, name, compressed);
    directoryParts.push(directory, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(directoryParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, directory, end]);
}
