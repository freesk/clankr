// Just enough XML for the parts of OOXML that inspect reads: a flat scan of tags and text.
// OOXML parts are machine-written and well-formed, and inspect needs only element names,
// a few attributes, and text runs, so a full DOM parser would be a dependency for nothing.

export type XmlToken =
  | { kind: "open"; name: string; attributes: Record<string, string>; selfClosing: boolean }
  | { kind: "close"; name: string }
  | { kind: "text"; text: string };

// Declarations and comments (`<?...>`, `<!...>`) match the first branch and yield nothing.
const tokenPattern =
  /<[?!][^>]*>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const attributePattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Tags and text in document order. Comments, declarations, and CDATA are skipped. */
export function* scanXml(xml: string): Generator<XmlToken> {
  for (const match of xml.matchAll(tokenPattern)) {
    const [, slash, name, attributeText, selfClosing, text] = match;
    if (text !== undefined) {
      yield { kind: "text", text: decodeEntities(text) };
    } else if (name !== undefined && slash === "/") {
      yield { kind: "close", name };
    } else if (name !== undefined) {
      yield {
        kind: "open",
        name,
        attributes: parseAttributes(attributeText ?? ""),
        selfClosing: selfClosing === "/",
      };
    }
  }
}

export function parseAttributes(text: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of text.matchAll(attributePattern)) {
    const [, name, doubleQuoted, singleQuoted] = match;
    if (name !== undefined) attributes[name] = decodeEntities(doubleQuoted ?? singleQuoted ?? "");
  }
  return attributes;
}

const namedEntities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (whole, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return namedEntities[entity] ?? whole;
  });
}
