// The sheet list of an `.xlsx` workbook and each sheet's used range. DuckDB's reader
// needs a sheet name and a cell range but cannot list sheets, so these come from the
// workbook's XML parts. Only the start of each sheet part is inflated.

import { posix } from "node:path";
import { scanXml } from "./xml-scan.ts";
import { ZipArchive } from "./zip-archive.ts";

export interface WorkbookSheet {
  name: string;
  /** The sheet's used range, for example "A1:F1200", when the file records one. */
  dimension?: string;
}

/** The `<dimension>` element comes before the rows, within the first few kilobytes. */
const sheetStartBytes = 16 * 1024;

export async function readWorkbookSheets(path: string): Promise<WorkbookSheet[]> {
  const archive = await ZipArchive.open(path);
  try {
    const workbookXml = (await archive.read("xl/workbook.xml")).toString("utf8");
    const relationsXml = archive.has("xl/_rels/workbook.xml.rels")
      ? (await archive.read("xl/_rels/workbook.xml.rels")).toString("utf8")
      : "";
    const targets = worksheetTargets(relationsXml);
    const sheets: WorkbookSheet[] = [];
    for (const { name, relationId } of sheetEntries(workbookXml)) {
      const target = targets.get(relationId);
      if (target === undefined) continue; // A chart sheet or a dangling entry: no cells.
      const dimension = archive.has(target)
        ? sheetDimension((await archive.readStart(target, sheetStartBytes)).toString("utf8"))
        : undefined;
      sheets.push(dimension ? { name, dimension } : { name });
    }
    return sheets;
  } finally {
    await archive.close();
  }
}

function sheetEntries(workbookXml: string): { name: string; relationId: string }[] {
  const entries: { name: string; relationId: string }[] = [];
  for (const token of scanXml(workbookXml)) {
    if (token.kind !== "open" || localName(token.name) !== "sheet") continue;
    const name = token.attributes.name;
    const relationId = token.attributes["r:id"] ?? attributeByLocalName(token.attributes, "id");
    if (name !== undefined && relationId !== undefined) entries.push({ name, relationId });
  }
  return entries;
}

/** Relationship id to zip entry name, for worksheet relationships only. */
function worksheetTargets(relationsXml: string): Map<string, string> {
  const targets = new Map<string, string>();
  for (const token of scanXml(relationsXml)) {
    if (token.kind !== "open" || localName(token.name) !== "Relationship") continue;
    const { Id: id, Target: target, Type: type } = token.attributes;
    if (!id || !target || !type?.endsWith("/worksheet")) continue;
    const entryName = target.startsWith("/")
      ? target.slice(1)
      : posix.normalize(posix.join("xl", target));
    targets.set(id, entryName);
  }
  return targets;
}

function sheetDimension(sheetXmlStart: string): string | undefined {
  const reference = /<(?:\w+:)?dimension\s+ref="([A-Z]+\d+(?::[A-Z]+\d+)?)"/.exec(
    sheetXmlStart,
  )?.[1];
  return reference;
}

function localName(name: string): string {
  return name.slice(name.indexOf(":") + 1);
}

function attributeByLocalName(
  attributes: Record<string, string>,
  wanted: string,
): string | undefined {
  const key = Object.keys(attributes).find((name) => name.endsWith(`:${wanted}`));
  return key === undefined ? undefined : attributes[key];
}
