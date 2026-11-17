// The Word writer, checked by reading its files back: with the project's own OOXML reader
// (the one inspect_data uses) and with macOS textutil, which shares no code with clankr.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { onePixelPng } from "../chart/test-support.ts";
import { isPng, pngSize } from "../shared/png-size.ts";
import { readDocxStructure } from "../tools/data/inspect/docx-document.ts";
import { buildDocx, type DocxDocument } from "./docx-writer.ts";
import { hasPackagePart, readPackagePart, textutilText } from "./testing/read-back.ts";

const portraitA4: DocxDocument["page"] = { size: "A4", orientation: "portrait" };

describe("buildDocx", () => {
  let folder: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "clankr-docx-"));
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  async function save(document: DocxDocument): Promise<string> {
    const path = join(folder, "out.docx");
    await writeFile(path, buildDocx(document));
    return path;
  }

  const table = {
    kind: "table" as const,
    columns: ["Region", "Units"],
    cells: [
      ["North & <West>", "1200"],
      ["South", "80"],
    ],
    numericColumns: [false, true],
  };

  it("writes headings and a table that the project's own reader finds", async () => {
    const path = await save({
      blocks: [{ kind: "heading", text: "Units by region" }, table],
      page: portraitA4,
      fontFamily: "Helvetica Neue",
    });
    const structure = await readDocxStructure(path);
    expect(structure.headings).toEqual([{ level: 1, text: "Units by region" }]);
    expect(structure.tables).toEqual([
      {
        number: 1,
        underHeading: "Units by region",
        grid: [
          ["Region", "Units"],
          ["North & <West>", "1200"],
          ["South", "80"],
        ],
      },
    ]);
  });

  it("is read by macOS textutil, an independent reader", async () => {
    const path = await save({
      blocks: [
        { kind: "heading", text: "Units by region" },
        { kind: "paragraph", text: "North sells the most.\nSouth trails." },
        table,
      ],
      page: portraitA4,
      fontFamily: "Helvetica Neue",
    });
    const text = await textutilText(path);
    expect(text).toContain("Units by region");
    expect(text).toContain("North sells the most.");
    expect(text).toContain("South trails.");
    expect(text).toContain("North & <West>");
    expect(text).toContain("1200");
  });

  it("embeds a picture as a PNG part the document refers to", async () => {
    const path = await save({
      blocks: [
        { kind: "heading", text: "A chart" },
        { kind: "image", png: onePixelPng, description: 'Sales "up" & rising' },
        { kind: "paragraph", text: "The summary under the picture." },
      ],
      page: portraitA4,
      fontFamily: "Helvetica Neue",
    });
    const image = await readPackagePart(path, "word/media/image1.png");
    expect(isPng(image)).toBe(true);
    expect(pngSize(image)).toEqual({ width: 1, height: 1 });

    const documentXml = (await readPackagePart(path, "word/document.xml")).toString("utf8");
    const relationships = (await readPackagePart(path, "word/_rels/document.xml.rels")).toString();
    const embedded = /r:embed="(rId\d+)"/.exec(documentXml)?.[1];
    expect(relationships).toContain(`Id="${embedded}"`);
    expect(relationships).toContain('Target="media/image1.png"');
    expect(documentXml).toContain('descr="Sales &quot;up&quot; &amp; rising"');
    const contentTypes = (await readPackagePart(path, "[Content_Types].xml")).toString();
    expect(contentTypes).toContain('Extension="png" ContentType="image/png"');
    // textutil still reads the text around the picture.
    expect(await textutilText(path)).toContain("The summary under the picture.");
  });

  it("applies the page size, the orientation, and the footer", async () => {
    const path = await save({
      blocks: [{ kind: "paragraph", text: "Body." }],
      page: { size: "Letter", orientation: "landscape" },
      fontFamily: "Georgia",
      footer: "Confidential <draft>",
    });
    const documentXml = (await readPackagePart(path, "word/document.xml")).toString("utf8");
    // Letter is 8.5 x 11 inches; a twip is 1/1440 inch.
    expect(documentXml).toContain('<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>');
    expect(documentXml).toMatch(/<w:footerReference w:type="default" r:id="rId\d+"\/>/);
    const footer = (await readPackagePart(path, "word/footer1.xml")).toString("utf8");
    expect(footer).toContain("Confidential &lt;draft&gt;");
    const styles = (await readPackagePart(path, "word/styles.xml")).toString("utf8");
    expect(styles).toContain('w:ascii="Georgia"');
  });

  it("leaves the footer part out when the theme has no footer", async () => {
    const path = await save({
      blocks: [{ kind: "paragraph", text: "Body." }],
      page: portraitA4,
      fontFamily: "Georgia",
    });
    expect(await hasPackagePart(path, "word/footer1.xml")).toBe(false);
    const documentXml = (await readPackagePart(path, "word/document.xml")).toString("utf8");
    expect(documentXml).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(documentXml).not.toContain("footerReference");
  });

  it("drops characters XML forbids, so one bad cell cannot spoil the file", async () => {
    const withControlCharacters = `ok${String.fromCharCode(0, 7, 0x1b)}text`;
    const path = await save({
      blocks: [{ kind: "paragraph", text: withControlCharacters }],
      page: portraitA4,
      fontFamily: "Georgia",
    });
    expect(await textutilText(path)).toContain("oktext");
  });

  it("starts a heading on a new page when asked", async () => {
    const path = await save({
      blocks: [
        { kind: "heading", text: "One" },
        { kind: "heading", text: "Two", startsPage: true },
      ],
      page: portraitA4,
      fontFamily: "Georgia",
    });
    const documentXml = (await readPackagePart(path, "word/document.xml")).toString("utf8");
    expect(documentXml.match(/<w:pageBreakBefore\/>/g)).toHaveLength(1);
  });
});
