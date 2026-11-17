// The fixed parts of a .docx package: content types, relationships, styles, and the footer.
// Written as raw WordprocessingML, as the project reads it (D17); see D88 for why no library.

import type { ZipEntry } from "../shared/zip-writer.ts";

const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const namespaces = {
  word: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  relationships: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  wordDrawing: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  drawing: "http://schemas.openxmlformats.org/drawingml/2006/main",
  picture: "http://schemas.openxmlformats.org/drawingml/2006/picture",
  packageRelationships: "http://schemas.openxmlformats.org/package/2006/relationships",
  contentTypes: "http://schemas.openxmlformats.org/package/2006/content-types",
};

export const pictureNamespace = namespaces.picture;

const wordContentType = "application/vnd.openxmlformats-officedocument.wordprocessingml";

/** Style ids the document body refers to. "heading 1" is the name Word and our reader know. */
export const styleIds = { heading: "Heading1", tableCell: "TableCell", footer: "Footer" };

export interface DocxPackage {
  /** Everything inside `<w:body>`, section properties included. */
  bodyXml: string;
  /** Embedded PNG images, in the order the body refers to them. */
  images: Buffer[];
  fontFamily: string;
  footer?: string | undefined;
}

/** Relationship ids, one numbering shared by the body and the relationships part. */
export const stylesRelationshipId = "rId1";
export const footerRelationshipId = "rId2";
export function imageRelationshipId(imageIndex: number): string {
  return `rId${imageIndex + 3}`;
}

/**
 * Text as XML content or an attribute value. Characters XML 1.0 forbids (most control
 * characters, half a surrogate pair) are dropped: one of them in a data cell would make Word
 * refuse the whole file.
 */
export function escapeXml(text: string): string {
  let allowed = "";
  for (const character of text) {
    if (isAllowedInXml(character.codePointAt(0) ?? 0)) allowed += character;
  }
  return allowed
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isAllowedInXml(codePoint: number): boolean {
  if (codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd) return true;
  if (codePoint < 0x20 || codePoint === 0xfffe || codePoint === 0xffff) return false;
  const isLoneSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
  return !isLoneSurrogate;
}

export function packageEntries(document: DocxPackage): ZipEntry[] {
  const hasFooter = Boolean(document.footer);
  const entries = [
    xmlEntry("[Content_Types].xml", contentTypesXml(document.images.length > 0, hasFooter)),
    xmlEntry("_rels/.rels", packageRelationshipsXml),
    xmlEntry("word/document.xml", documentXml(document.bodyXml)),
    xmlEntry("word/_rels/document.xml.rels", documentRelationshipsXml(document)),
    xmlEntry("word/styles.xml", stylesXml(document.fontFamily)),
  ];
  if (document.footer) entries.push(xmlEntry("word/footer1.xml", footerXml(document.footer)));
  // A PNG is already compressed, so it is stored as it is.
  document.images.forEach((png, index) => {
    entries.push({ name: `word/media/image${index + 1}.png`, data: png });
  });
  return entries;
}

function xmlEntry(name: string, xml: string): ZipEntry {
  return { name, data: Buffer.from(xmlDeclaration + xml, "utf8"), compress: true };
}

function documentXml(bodyXml: string): string {
  const declared = [
    `xmlns:w="${namespaces.word}"`,
    `xmlns:r="${namespaces.relationships}"`,
    `xmlns:wp="${namespaces.wordDrawing}"`,
    `xmlns:a="${namespaces.drawing}"`,
    `xmlns:pic="${namespaces.picture}"`,
  ].join(" ");
  return `<w:document ${declared}><w:body>${bodyXml}</w:body></w:document>`;
}

function contentTypesXml(hasImages: boolean, hasFooter: boolean): string {
  const override = (part: string, type: string) =>
    `<Override PartName="${part}" ContentType="${wordContentType}.${type}+xml"/>`;
  return [
    `<Types xmlns="${namespaces.contentTypes}">`,
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    hasImages ? '<Default Extension="png" ContentType="image/png"/>' : "",
    override("/word/document.xml", "document.main"),
    override("/word/styles.xml", "styles"),
    hasFooter ? override("/word/footer1.xml", "footer") : "",
    "</Types>",
  ].join("");
}

const packageRelationshipsXml = `<Relationships xmlns="${namespaces.packageRelationships}"><Relationship Id="rId1" Type="${namespaces.relationships}/officeDocument" Target="word/document.xml"/></Relationships>`;

function documentRelationshipsXml(document: DocxPackage): string {
  const relationship = (id: string, type: string, target: string) =>
    `<Relationship Id="${id}" Type="${namespaces.relationships}/${type}" Target="${target}"/>`;
  return [
    `<Relationships xmlns="${namespaces.packageRelationships}">`,
    relationship(stylesRelationshipId, "styles", "styles.xml"),
    document.footer ? relationship(footerRelationshipId, "footer", "footer1.xml") : "",
    ...document.images.map((_, index) =>
      relationship(imageRelationshipId(index), "image", `media/image${index + 1}.png`),
    ),
    "</Relationships>",
  ].join("");
}

/** Sizes are half-points: 22 is 11 pt body text, 18 is 9 pt for table cells and the footer. */
function stylesXml(fontFamily: string): string {
  const font = escapeXml(fontFamily);
  const style = (id: string, name: string, properties: string) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>${properties}</w:style>`;
  return [
    `<w:styles xmlns:w="${namespaces.word}">`,
    `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>`,
    '<w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults>',
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>',
    style(
      styleIds.heading,
      "heading 1",
      '<w:pPr><w:keepNext/><w:spacing w:after="160"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr>',
    ),
    style(
      styleIds.tableCell,
      "Table Cell",
      '<w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="18"/></w:rPr>',
    ),
    style(styleIds.footer, "footer", '<w:rPr><w:color w:val="555555"/><w:sz w:val="18"/></w:rPr>'),
    "</w:styles>",
  ].join("");
}

function footerXml(footer: string): string {
  return `<w:ftr xmlns:w="${namespaces.word}"><w:p><w:pPr><w:pStyle w:val="${styleIds.footer}"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(footer)}</w:t></w:r></w:p></w:ftr>`;
}
