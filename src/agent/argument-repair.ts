// Lenient argument handling (PRD section 6.2, risk row 1). Before rejecting a call, repair
// what can be repaired safely, then validate with the tool's own zod schema. Every repair
// is reported, so evals can tell first-attempt validity from a rescued call.

import { invalidArgumentsMessage, unparseableArgumentsMessage } from "./corrective-errors.ts";
import { isPlainObject, parseArgumentsLeniently } from "./lenient-json.ts";
import type { RegisteredTool } from "./registry.ts";
import {
  acceptedTypes,
  type JsonSchemaObject,
  schemaProperties,
  toolSignature,
} from "./tool-schema.ts";

export type ArgumentCheck =
  | { ok: true; args: Record<string, unknown>; repaired: boolean }
  | { ok: false; error: string; bestEffortArgs: Record<string, unknown> };

export function checkArguments(tool: RegisteredTool, rawArguments: string): ArgumentCheck {
  const signature = toolSignature(tool.definition);
  const parsed = parseArgumentsLeniently(rawArguments);
  if (!parsed.ok) {
    return { ok: false, error: unparseableArgumentsMessage(signature), bestEffortArgs: {} };
  }

  const fields = repairFields(parsed.value, schemaProperties(tool.parameterSchema));
  const validation = tool.definition.parameters.safeParse(fields.value);
  if (!validation.success) {
    return {
      ok: false,
      error: invalidArgumentsMessage(validation.error.issues, signature),
      bestEffortArgs: fields.value,
    };
  }
  return {
    ok: true,
    args: validation.data as Record<string, unknown>,
    repaired: parsed.repaired || fields.repaired,
  };
}

interface FieldRepair {
  value: Record<string, unknown>;
  repaired: boolean;
}

function repairFields(
  received: Record<string, unknown>,
  properties: Record<string, JsonSchemaObject>,
): FieldRepair {
  const value: Record<string, unknown> = {};
  let repaired = false;
  for (const [receivedName, receivedValue] of Object.entries(received)) {
    const name = matchParameterName(receivedName, properties);
    // An unknown extra field is dropped: zod would strip it anyway, and rejecting the
    // whole call for it would waste a round.
    if (name === undefined) {
      repaired = true;
      continue;
    }
    const coerced = coerceValue(receivedValue, acceptedTypes(properties[name] as JsonSchemaObject));
    repaired ||= name !== receivedName || coerced.changed;
    value[name] = coerced.value;
  }
  return { value, repaired };
}

/** Exact match first, then a case-insensitive one ("Path" for "path"). */
function matchParameterName(
  receivedName: string,
  properties: Record<string, JsonSchemaObject>,
): string | undefined {
  if (receivedName in properties) return receivedName;
  const lowered = receivedName.toLowerCase();
  return Object.keys(properties).find((name) => name.toLowerCase() === lowered);
}

interface Coercion {
  value: unknown;
  changed: boolean;
}

function coerceValue(value: unknown, types: string[]): Coercion {
  const unchanged = { value, changed: false };
  if (types.length === 0 || types.includes(jsonTypeOf(value))) return unchanged;
  // JSON schema says "integer" where typeof says "number".
  if (types.includes("integer") && Number.isInteger(value)) return unchanged;

  if (typeof value === "string") return coerceString(value, types) ?? unchanged;
  if (typeof value === "number" && types.includes("string")) {
    return { value: String(value), changed: true };
  }
  if (types.includes("array") && value !== null && value !== undefined) {
    return { value: [value], changed: true };
  }
  return unchanged;
}

function coerceString(text: string, types: string[]): Coercion | undefined {
  const trimmed = text.trim();
  if ((types.includes("number") || types.includes("integer")) && isNumericText(trimmed)) {
    return { value: Number(trimmed), changed: true };
  }
  if (types.includes("boolean") && (trimmed === "true" || trimmed === "false")) {
    return { value: trimmed === "true", changed: true };
  }
  if (types.includes("array")) {
    const parsed = parseJsonArray(trimmed);
    return { value: parsed ?? [text], changed: true };
  }
  if (types.includes("null") && trimmed === "null") return { value: null, changed: true };
  return undefined;
}

function parseJsonArray(text: string): unknown[] | undefined {
  if (!text.startsWith("[")) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isNumericText(text: string): boolean {
  return text !== "" && Number.isFinite(Number(text));
}

function jsonTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (isPlainObject(value)) return "object";
  return typeof value;
}
