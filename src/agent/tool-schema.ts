// Turns a tool's zod parameters into the JSON schema the model sees, and into the
// one-line signature used by the prompt-based style and by corrective errors.

import { z } from "zod";
import type { ToolDefinition, ToolSchema } from "../contracts/index.ts";

export type JsonSchemaObject = Record<string, unknown>;

/** Keys zod adds that cost tokens and tell a small model nothing useful. */
const noiseKeys = new Set(["$schema", "additionalProperties"]);

export function buildToolSchema(tool: ToolDefinition): ToolSchema {
  return {
    name: tool.name,
    description: tool.description,
    parameters: parameterSchema(tool),
  };
}

/**
 * The JSON schema of a tool's parameters, as the caller writes them: `io: "input"` keeps
 * fields that have a default out of `required`.
 */
export function parameterSchema(tool: ToolDefinition): JsonSchemaObject {
  const generated = z.toJSONSchema(tool.parameters, { io: "input", unrepresentable: "any" });
  return removeNoise(generated as JsonSchemaObject);
}

/** Properties of a flat parameter schema, keyed by parameter name. */
export function schemaProperties(schema: JsonSchemaObject): Record<string, JsonSchemaObject> {
  return (schema.properties ?? {}) as Record<string, JsonSchemaObject>;
}

export function requiredParameters(schema: JsonSchemaObject): Set<string> {
  return new Set((schema.required ?? []) as string[]);
}

/** JSON types a property accepts, looking through `anyOf` (zod's encoding of `.nullable()`). */
export function acceptedTypes(property: JsonSchemaObject): string[] {
  const types: string[] = [];
  const declared = property.type;
  if (typeof declared === "string") types.push(declared);
  if (Array.isArray(declared)) types.push(...(declared as string[]));
  for (const option of (property.anyOf ?? []) as JsonSchemaObject[]) {
    types.push(...acceptedTypes(option));
  }
  if (property.enum && types.length === 0) types.push("string");
  return types;
}

/** For example `read_file(path: string, start_line?: integer)`. */
export function toolSignature(tool: ToolDefinition): string {
  const schema = parameterSchema(tool);
  const required = requiredParameters(schema);
  const parameters = Object.entries(schemaProperties(schema)).map(([name, property]) => {
    const optionalMark = required.has(name) ? "" : "?";
    return `${name}${optionalMark}: ${describeType(property)}`;
  });
  return `${tool.name}(${parameters.join(", ")})`;
}

function describeType(property: JsonSchemaObject): string {
  const enumValues = findEnum(property);
  if (enumValues) return enumValues.map((value) => JSON.stringify(value)).join(" | ");
  const options = (property.anyOf ?? []) as JsonSchemaObject[];
  if (options.length > 0) {
    // Null is left out: an omitted parameter says the same thing in fewer tokens.
    const described = options.filter((option) => option.type !== "null").map(describeType);
    return described.join(" | ") || "any";
  }
  const types = acceptedTypes(property).filter((type) => type !== "null");
  if (types.includes("array")) {
    const items = (property.items ?? {}) as JsonSchemaObject;
    return `${describeType(items)}[]`;
  }
  return types.join(" | ") || "any";
}

function findEnum(property: JsonSchemaObject): unknown[] | undefined {
  if (Array.isArray(property.enum)) return property.enum;
  for (const option of (property.anyOf ?? []) as JsonSchemaObject[]) {
    const found = findEnum(option);
    if (found) return found;
  }
  return undefined;
}

function removeNoise(schema: JsonSchemaObject): JsonSchemaObject {
  const cleaned: JsonSchemaObject = {};
  for (const [key, value] of Object.entries(schema)) {
    if (noiseKeys.has(key) || isSafeIntegerBound(key, value)) continue;
    cleaned[key] = cleanValue(value);
  }
  return cleaned;
}

function cleanValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanValue);
  if (value !== null && typeof value === "object") return removeNoise(value as JsonSchemaObject);
  return value;
}

/** `z.number().int()` adds the safe-integer range as bounds; they are noise to the model. */
function isSafeIntegerBound(key: string, value: unknown): boolean {
  return (
    (key === "maximum" && value === Number.MAX_SAFE_INTEGER) ||
    (key === "minimum" && value === Number.MIN_SAFE_INTEGER)
  );
}
