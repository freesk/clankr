// Rewrites raw JSON-schema errors into a few short, fixable messages (DATA-11). The Vega-Lite
// schema is a large tree of alternatives, so one mistake produces dozens of errors, most of
// them from alternatives the model never meant. Two rules pick the useful ones:
//  1. The deepest location wins: alternatives that fail near the root are noise.
//  2. A property is reported unknown only when no alternative at that location accepts it.

export interface SchemaError {
  instancePath: string;
  keyword: string;
  params: Record<string, unknown>;
  /** The schema object that failed (Ajv's `verbose` mode). */
  parentSchema?: { properties?: Record<string, unknown> };
}

const maxMessages = 3;
const maxListedValues = 12;

export function rewriteSchemaErrors(errors: SchemaError[], spec: unknown): string[] {
  const relevant = errors.filter((error) => !["anyOf", "oneOf", "if"].includes(error.keyword));
  const deepest = Math.max(...relevant.map((error) => depth(error.instancePath)));
  const atDeepest = relevant.filter((error) => depth(error.instancePath) === deepest);
  const paths = [...new Set(atDeepest.map((error) => error.instancePath))];
  const messages = paths.flatMap((path) =>
    messagesForPath(
      atDeepest.filter((error) => error.instancePath === path),
      path,
      spec,
    ),
  );
  return messages.slice(0, maxMessages);
}

function messagesForPath(errors: SchemaError[], path: string, spec: unknown): string[] {
  const location = readableLocation(path);
  const allowed = allowedValues(errors);
  if (allowed.length > 0) {
    const found = valueAt(spec, path);
    const candidates = allowed.filter((value): value is string => typeof value === "string");
    const suggestion = typeof found === "string" ? closestMatch(found, candidates) : undefined;
    const hint = suggestion ? ` Did you mean "${suggestion}"?` : "";
    return [
      `${location}: ${JSON.stringify(found)} is not allowed.${hint} Use one of: ${formatList(allowed)}.`,
    ];
  }
  const unknown = trulyUnknownProperties(errors);
  if (unknown.length > 0) {
    const known = knownProperties(errors);
    return unknown.map((property) => unknownPropertyMessage(location, property, known));
  }
  const expectedTypes = unique(
    errors.filter((error) => error.keyword === "type").map((error) => String(error.params.type)),
  );
  if (expectedTypes.length > 0) {
    const found = describeType(valueAt(spec, path));
    return [`${location}: expected ${expectedTypes.join(" or ")}, found ${found}.`];
  }
  const missing = unique(
    errors
      .filter((error) => error.keyword === "required")
      .map((error) => String(error.params.missingProperty)),
  );
  if (missing.length > 0) return [`${location}: missing ${formatList(missing)}.`];
  const first = errors[0];
  return first ? [`${location}: ${first.keyword} check failed.`] : [];
}

/** `enum` and `const` alternatives at one location, merged into one list. */
function allowedValues(errors: SchemaError[]): unknown[] {
  const values: unknown[] = [];
  for (const error of errors) {
    if (error.keyword === "enum") values.push(...(error.params.allowedValues as unknown[]));
    if (error.keyword === "const") values.push(error.params.allowedValue);
  }
  return unique(values);
}

function trulyUnknownProperties(errors: SchemaError[]): string[] {
  const known = knownProperties(errors);
  const reported = errors
    .filter((error) => error.keyword === "additionalProperties")
    .map((error) => String(error.params.additionalProperty));
  return unique(reported).filter((property) => !known.has(property));
}

function knownProperties(errors: SchemaError[]): Set<string> {
  const known = new Set<string>();
  for (const error of errors) {
    for (const property of Object.keys(error.parentSchema?.properties ?? {})) known.add(property);
  }
  return known;
}

function unknownPropertyMessage(location: string, property: string, known: Set<string>): string {
  const suggestion = closestMatch(property, [...known]);
  const hint = suggestion ? ` Did you mean "${suggestion}"?` : "";
  return `${location}: unknown property "${property}".${hint}`;
}

/** The known name within an edit distance of 3, so "feild" suggests "field". */
function closestMatch(word: string, candidates: string[]): string | undefined {
  let best: { candidate: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const distance = editDistance(word.toLowerCase(), candidate.toLowerCase());
    if (distance <= 3 && (!best || distance < best.distance)) best = { candidate, distance };
  }
  return best?.candidate;
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const current = [row];
    for (let column = 1; column <= right.length; column++) {
      const substitution =
        (previous[column - 1] ?? 0) + (left[row - 1] === right[column - 1] ? 0 : 1);
      current.push(
        Math.min((previous[column] ?? 0) + 1, (current[column - 1] ?? 0) + 1, substitution),
      );
    }
    previous = current;
  }
  return previous[right.length] ?? 0;
}

function depth(instancePath: string): number {
  return instancePath === "" ? 0 : instancePath.split("/").length - 1;
}

function pathSegments(instancePath: string): string[] {
  return instancePath
    .split("/")
    .slice(1)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

/** "/layer/0/encoding/x" becomes "layer[0].encoding.x". */
export function readableLocation(instancePath: string): string {
  if (instancePath === "") return "spec";
  return pathSegments(instancePath).reduce(
    (location, segment) =>
      /^\d+$/.test(segment)
        ? `${location}[${segment}]`
        : location
          ? `${location}.${segment}`
          : segment,
    "",
  );
}

function valueAt(spec: unknown, instancePath: string): unknown {
  let value = spec;
  for (const segment of pathSegments(instancePath)) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value === "string" ? `the string ${JSON.stringify(value)}` : typeof value;
}

function formatList(values: unknown[]): string {
  const listed = values.slice(0, maxListedValues).map((value) => JSON.stringify(value));
  const more =
    values.length > maxListedValues ? `, and ${values.length - maxListedValues} more` : "";
  return `${listed.join(", ")}${more}`;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
