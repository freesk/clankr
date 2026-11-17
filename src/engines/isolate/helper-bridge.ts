// The host side of the isolate boundary: collects console output and dispatches helper calls.
// Arguments and replies cross as JSON strings (see isolate-source.ts).

import type { IsolateHelper, JsonValue } from "../../contracts/index.ts";
import { ToolError } from "../../contracts/index.ts";

/**
 * Host-memory guards, not user settings: the isolate's own memory limit already bounds what the
 * model can build, these stop it from being multiplied on the host side.
 */
const maxLogCharacters = 100_000;
const maxHelperArgumentCharacters = 64 * 1024 * 1024;

const helperNamePattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const reservedNames = new Set(["console", "globalThis", "JSON", "Object", "Array", "Promise"]);

/** Console output, kept up to a fixed size so a logging loop cannot exhaust host memory. */
export class LogCollector {
  private readonly collected: string[] = [];
  private characters = 0;
  private dropped = false;

  add(line: string): void {
    if (this.dropped) return;
    if (this.characters + line.length > maxLogCharacters) {
      this.dropped = true;
      return;
    }
    this.characters += line.length;
    this.collected.push(line);
  }

  lines(): string[] {
    if (!this.dropped) return [...this.collected];
    return [...this.collected, "[more console output was dropped]"];
  }
}

export function assertValidHelperNames(helpers: Record<string, IsolateHelper>): void {
  for (const name of Object.keys(helpers)) {
    if (!helperNamePattern.test(name) || reservedNames.has(name)) {
      throw new Error(`Invalid isolate helper name: ${name}`);
    }
  }
}

type HelperReply = { ok: true; value?: JsonValue } | { ok: false; error: string };

/**
 * Builds the function the isolate calls for every helper. It never throws: failures go back as
 * an error reply, which the isolate rethrows as an Error of its own, so no host stack frame
 * reaches the model.
 */
export function createHelperDispatcher(
  helpers: Record<string, IsolateHelper>,
): (name: string, argumentsJson: string) => Promise<string> {
  return async (name, argumentsJson) => {
    const reply = await callHelper(helpers, name, argumentsJson);
    return JSON.stringify(reply);
  };
}

async function callHelper(
  helpers: Record<string, IsolateHelper>,
  name: string,
  argumentsJson: string,
): Promise<HelperReply> {
  const helper = Object.hasOwn(helpers, name) ? helpers[name] : undefined;
  if (!helper) return { ok: false, error: `${name} is not available.` };
  if (argumentsJson.length > maxHelperArgumentCharacters) {
    return { ok: false, error: `Too much data passed to ${name}(). Pass fewer or smaller rows.` };
  }
  try {
    const value = await helper(...parseArguments(argumentsJson));
    return value === undefined ? { ok: true } : { ok: true, value };
  } catch (error) {
    return { ok: false, error: helperErrorMessage(name, error) };
  }
}

function parseArguments(argumentsJson: string): JsonValue[] {
  const parsed: unknown = JSON.parse(argumentsJson);
  return Array.isArray(parsed) ? (parsed as JsonValue[]) : [];
}

// Only a ToolError's message is meant for the model. Anything else may carry host detail such
// as a file path, so it is reported generically.
function helperErrorMessage(name: string, error: unknown): string {
  if (error instanceof ToolError) return error.message;
  return `${name}() failed unexpectedly.`;
}
