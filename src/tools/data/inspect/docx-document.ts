// `.docx` structure for the document profile (DATA-3, D17): the heading outline and every
// top-level table as a grid of cell text. A direct OOXML reader: word/document.xml for the
// body, word/styles.xml to know which paragraph styles are headings.

import { scanXml, type XmlToken } from "./xml-scan.ts";
import { ZipArchive } from "./zip-archive.ts";

export interface DocxHeading {
  level: number;
  text: string;
}

export interface DocxTable {
  /** 1-based, in document order. */
  number: number;
  /** The nearest heading above the table, if any. */
  underHeading?: string;
  grid: string[][];
}

export interface DocxStructure {
  headings: DocxHeading[];
  tables: DocxTable[];
}

export async function readDocxStructure(path: string): Promise<DocxStructure> {
  const archive = await ZipArchive.open(path);
  try {
    const documentXml = (await archive.read("word/document.xml")).toString("utf8");
    const stylesXml = archive.has("word/styles.xml")
      ? (await archive.read("word/styles.xml")).toString("utf8")
      : "";
    return parseDocument(documentXml, headingLevelsByStyle(stylesXml));
  } finally {
    await archive.close();
  }
}

/** Style id to heading level, from style names ("heading 2", "Title") or outline levels. */
export function headingLevelsByStyle(stylesXml: string): Map<string, number> {
  const levels = new Map<string, number>();
  let styleId: string | undefined;
  for (const token of scanXml(stylesXml)) {
    if (token.kind === "open" && token.name === "w:style") styleId = token.attributes["w:styleId"];
    if (token.kind !== "open" || styleId === undefined) continue;
    const value = token.attributes["w:val"] ?? "";
    if (token.name === "w:name") {
      const level = /^heading (\d)$/i.exec(value)?.[1];
      if (level) levels.set(styleId, Number(level));
      if (/^title$/i.test(value)) levels.set(styleId, 1);
    }
    if (token.name === "w:outlineLvl" && !levels.has(styleId))
      levels.set(styleId, Number(value) + 1);
  }
  return levels;
}

/** Walks the body once, keeping only the state a heading or a table cell needs. */
export function parseDocument(
  documentXml: string,
  headingLevels: Map<string, number>,
): DocxStructure {
  const parser = new DocumentWalker(headingLevels);
  for (const token of scanXml(documentXml)) parser.accept(token);
  return { headings: parser.headings, tables: parser.tables };
}

class DocumentWalker {
  readonly headings: DocxHeading[] = [];
  readonly tables: DocxTable[] = [];
  private tableDepth = 0;
  private insideText = false;
  private paragraphText = "";
  private paragraphLevel: number | undefined;
  private currentTable: DocxTable | undefined;
  private currentRow: string[] = [];
  private cellText = "";
  private cellSpan = 1;
  private cellContinuesMerge = false;

  private readonly headingLevels: Map<string, number>;

  constructor(headingLevels: Map<string, number>) {
    this.headingLevels = headingLevels;
  }

  accept(token: XmlToken): void {
    if (token.kind === "text") {
      if (this.insideText) this.addText(token.text);
    } else if (token.kind === "open") {
      this.open(token.name, token.attributes, token.selfClosing);
    } else {
      this.close(token.name);
    }
  }

  private open(name: string, attributes: Record<string, string>, selfClosing: boolean): void {
    const value = attributes["w:val"];
    if (name === "w:t") this.insideText = !selfClosing;
    else if (name === "w:tab" || name === "w:br") this.addText(" ");
    else if (name === "w:p") this.startParagraph();
    else if (name === "w:pStyle" && value) this.paragraphLevel = this.headingLevels.get(value);
    else if (name === "w:outlineLvl" && value && this.paragraphLevel === undefined) {
      this.paragraphLevel = Number(value) + 1;
    } else if (name === "w:tbl") this.startTable();
    else if (this.tableDepth === 1) this.openTablePart(name, value, selfClosing);
  }

  private openTablePart(name: string, value: string | undefined, selfClosing: boolean): void {
    if (name === "w:tr") this.currentRow = [];
    else if (name === "w:tc") {
      this.cellText = "";
      this.cellSpan = 1;
      this.cellContinuesMerge = false;
    } else if (name === "w:gridSpan" && value) this.cellSpan = Math.max(1, Number(value));
    else if (name === "w:vMerge" && (selfClosing || value === "continue") && value !== "restart") {
      this.cellContinuesMerge = true;
    }
  }

  private close(name: string): void {
    if (name === "w:t") this.insideText = false;
    else if (name === "w:p") this.endParagraph();
    else if (name === "w:tbl") this.endTable();
    else if (this.tableDepth !== 1) return;
    else if (name === "w:tc") this.endCell();
    else if (name === "w:tr") this.currentTable?.grid.push(this.currentRow);
  }

  private addText(text: string): void {
    if (this.tableDepth > 0) this.cellText += text;
    else this.paragraphText += text;
  }

  private startParagraph(): void {
    if (this.tableDepth > 0) {
      if (this.cellText !== "") this.cellText += " ";
      return;
    }
    this.paragraphText = "";
    this.paragraphLevel = undefined;
  }

  private endParagraph(): void {
    if (this.tableDepth > 0 || this.paragraphLevel === undefined) return;
    const text = this.paragraphText.replace(/\s+/g, " ").trim();
    if (text) this.headings.push({ level: this.paragraphLevel, text });
  }

  private startTable(): void {
    this.tableDepth++;
    if (this.tableDepth > 1) return; // A nested table's text joins the enclosing cell.
    const heading = this.headings.at(-1)?.text;
    this.currentTable = { number: this.tables.length + 1, grid: [] };
    if (heading) this.currentTable.underHeading = heading;
  }

  private endTable(): void {
    this.tableDepth--;
    if (this.tableDepth === 0 && this.currentTable) {
      this.tables.push(this.currentTable);
      this.currentTable = undefined;
    }
  }

  /** A vertically merged cell repeats the value above it; a wide cell is followed by blanks. */
  private endCell(): void {
    const column = this.currentRow.length;
    const above = this.currentTable?.grid.at(-1)?.[column] ?? "";
    const text = this.cellContinuesMerge ? above : this.cellText.replace(/\s+/g, " ").trim();
    this.currentRow.push(text);
    for (let extra = 1; extra < this.cellSpan; extra++) this.currentRow.push("");
  }
}
