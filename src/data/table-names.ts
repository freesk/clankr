// SQL table names for inspected files. They are part of the contract with the model:
// the profile prints them and query_sql resolves them. Names are short, plain
// identifiers (no quoting needed), and stable within a session: inspecting the same
// file again yields the same names, because a name already owned by that file is reused.

import { basename, extname } from "node:path";
import type { DataSourceRegistry } from "../contracts/index.ts";

const maximumPartLength = 24;

/**
 * One name per label, in order. A file with a single table is named after the file;
 * a file with several gets the file name plus the sheet or table label.
 */
export function allocateTableNames(
  registry: DataSourceRegistry,
  realPath: string,
  labels: string[],
): string[] {
  const fileStem = identifierPart(basename(realPath, extname(realPath))) || "data";
  const taken = new Set<string>();
  return labels.map((label) => {
    const base = labels.length === 1 ? fileStem : `${fileStem}_${identifierPart(label) || "table"}`;
    const name = firstFreeName(plainIdentifier(base), (candidate) => {
      if (taken.has(candidate)) return false;
      const owner = registry.findByTable(candidate);
      return owner === undefined || owner.realPath === realPath;
    });
    taken.add(name);
    return name;
  });
}

/** Lower case, letters, digits, and underscores only, collapsed and trimmed. */
function identifierPart(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maximumPartLength)
    .replace(/_+$/, "");
}

/** A name the model can type unquoted: starts with a letter and is not an SQL keyword. */
function plainIdentifier(name: string): string {
  if (!/^[a-z]/.test(name)) return `t_${name}`;
  return reservedWords.has(name) ? `${name}_data` : name;
}

const reservedWords = new Set(
  (
    "all analyse analyze and any array as asc between both by case cast check collate column " +
    "constraint create default desc distinct do else end except false fetch for foreign from " +
    "grant group having in initially intersect into is join lateral leading limit not null " +
    "offset on only or order pivot placing primary qualify references returning select " +
    "some symmetric table then to trailing true union unique unpivot user using values " +
    "variadic when where window with"
  ).split(" "),
);

function firstFreeName(base: string, isFree: (candidate: string) => boolean): string {
  if (isFree(base)) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base}_${suffix}`;
    if (isFree(candidate)) return candidate;
  }
}
