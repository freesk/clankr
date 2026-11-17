// Translates `find_files` filters into one Spotlight metadata query. The model never
// writes query syntax. The query only narrows: Spotlight's matching differs from ours
// in small ways (wildcards, diacritics), so every path it returns is checked again by
// `matchesCriteria`. The query must therefore match a superset of the real answer.

import type { FileCriteria } from "./file-criteria.ts";
import { kindExtensions } from "./file-kinds.ts";
import { expandBraces, hasGlobCharacters } from "./glob.ts";

/** Matches every file and folder Spotlight knows about. */
const everythingQuery = "kMDItemContentTypeTree == 'public.item'";

export function buildSpotlightQuery(criteria: FileCriteria): string {
  const clauses = [
    nameClause(criteria.pattern),
    kindClause(criteria),
    ...rangeClauses(criteria),
  ].filter((clause): clause is string => clause !== undefined);
  return clauses.length === 0 ? everythingQuery : clauses.join(" && ");
}

function nameClause(pattern: string | undefined): string | undefined {
  if (!pattern) return undefined;
  const values = expandBraces(pattern).map(spotlightNameValue);
  // A bare "*" matches nothing in Spotlight, so a pattern that is all wildcards adds no clause.
  if (values.some((value) => /^\**$/.test(value))) return undefined;
  return anyOf(values.map((value) => `kMDItemFSName == '${value}'cd`));
}

/**
 * Spotlight supports only `*`. A `?` or a `[...]` class becomes `*`, which matches more
 * than asked; the post-filter removes the extra. Plain text means "name contains".
 */
function spotlightNameValue(pattern: string): string {
  if (!hasGlobCharacters(pattern)) return `*${escapeValue(pattern)}*`;
  return escapeValue(pattern.replace(/\[[^\]]*\]/g, "*").replace(/\?/g, "*")).replace(/\*+/g, "*");
}

function kindClause(criteria: FileCriteria): string | undefined {
  const kind = criteria.kind;
  if (!kind || kind === "file") return undefined;
  // Packages such as .app bundles are folders on disk; public.directory includes them,
  // which agrees with stat().isDirectory() in the post-filter.
  if (kind === "folder") return "kMDItemContentTypeTree == 'public.directory'";
  return anyOf(kindExtensions[kind].map((extension) => `kMDItemFSName == '*.${extension}'c`));
}

function rangeClauses(criteria: FileCriteria): (string | undefined)[] {
  return [
    bound("kMDItemFSSize", ">=", criteria.minSizeBytes),
    bound("kMDItemFSSize", "<=", criteria.maxSizeBytes),
    dateBound("kMDItemFSContentChangeDate", ">=", criteria.modifiedAfterMs),
    dateBound("kMDItemFSContentChangeDate", "<", criteria.modifiedBeforeMs),
    dateBound("kMDItemFSCreationDate", ">=", criteria.createdAfterMs),
    dateBound("kMDItemFSCreationDate", "<", criteria.createdBeforeMs),
  ];
}

function bound(attribute: string, operator: string, value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${attribute} ${operator} ${Math.round(value)}`;
}

function dateBound(
  attribute: string,
  operator: string,
  timeMs: number | undefined,
): string | undefined {
  if (timeMs === undefined) return undefined;
  return `${attribute} ${operator} $time.iso(${new Date(timeMs).toISOString()})`;
}

function anyOf(clauses: string[]): string {
  return clauses.length === 1 ? (clauses[0] as string) : `(${clauses.join(" || ")})`;
}

/** Spotlight string values are single-quoted; backslash escapes quotes and backslashes. */
function escapeValue(text: string): string {
  return text.replace(/[\\'"]/g, "\\$&");
}
