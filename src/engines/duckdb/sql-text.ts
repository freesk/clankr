// Quoting for SQL the harness writes itself (views, profiling queries).
// Model-written SQL is never assembled from pieces; it is checked and run as given.

/** A string literal: single quotes, with embedded quotes doubled. */
export function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** An identifier: double quotes, with embedded quotes doubled. */
export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

const identifierPattern = /"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*)/g;

/**
 * Every identifier-like word in a SQL text, lower-cased, with quoted identifiers unquoted.
 * String literals are skipped so a value like 'sales' is not mistaken for a table.
 * Used to find which registered tables a query names, without running it.
 */
export function identifiersIn(sql: string): Set<string> {
  const withoutLiterals = sql.replace(/'(?:[^']|'')*'/g, "''");
  const found = new Set<string>();
  for (const match of withoutLiterals.matchAll(identifierPattern)) {
    const quoted = match[1];
    const word = quoted !== undefined ? quoted.replaceAll('""', '"') : (match[2] ?? "");
    found.add(word.toLowerCase());
  }
  return found;
}
