// The tool registry: collects every part's ToolDefinitions, checks them against the
// tool contract (PRD section 6.2), and caches the JSON schema each one sends to the model.

import type { ToolDefinition, ToolSchema } from "../contracts/index.ts";
import {
  buildToolSchema,
  type JsonSchemaObject,
  parameterSchema,
  schemaProperties,
} from "./tool-schema.ts";

/**
 * PERM-6: there is no shell tool. A tool with one of these names is refused at registration,
 * so one cannot be added by accident; evals asserts the same thing from outside.
 */
const forbiddenShellToolNames = new Set([
  "shell",
  "bash",
  "sh",
  "zsh",
  "exec",
  "run_command",
  "run_shell",
  "execute_command",
  "terminal",
]);

const toolNamePattern = /^[a-z][a-z0-9_]*$/;

export interface RegisteredTool {
  definition: ToolDefinition;
  schema: ToolSchema;
  /** The generated parameter schema, used by argument repair. */
  parameterSchema: JsonSchemaObject;
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  constructor(definitions: readonly ToolDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: ToolDefinition): void {
    assertValidDefinition(definition);
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool "${definition.name}" is registered twice`);
    }
    this.tools.set(definition.name, {
      definition,
      schema: buildToolSchema(definition),
      parameterSchema: parameterSchema(definition),
    });
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /** Registration order is kept, so the tool list sent to the model is stable (CTX-9). */
  list(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  names(): string[] {
    return [...this.tools.keys()];
  }
}

function assertValidDefinition(definition: ToolDefinition): void {
  const { name } = definition;
  if (!toolNamePattern.test(name)) {
    throw new Error(`Tool name "${name}" must be lower snake case`);
  }
  if (forbiddenShellToolNames.has(name)) {
    throw new Error(`Tool "${name}" looks like a shell tool, which vix never offers (PERM-6)`);
  }
  if (definition.groups.length === 0) {
    throw new Error(`Tool "${name}" belongs to no tool group`);
  }
  if (definition.permission !== "read" && !definition.previewChange) {
    throw new Error(`Tool "${name}" changes things, so it must define previewChange (FS-7)`);
  }
  assertFlatParameters(definition);
}

/** Small models handle flat schemas far better than nested ones (PRD section 6.2). */
function assertFlatParameters(definition: ToolDefinition): void {
  const properties = schemaProperties(parameterSchema(definition));
  for (const [parameter, property] of Object.entries(properties)) {
    if (containsObjectType(property)) {
      throw new Error(
        `Tool "${definition.name}" parameter "${parameter}" is an object; parameters must be flat`,
      );
    }
  }
}

function containsObjectType(property: JsonSchemaObject): boolean {
  if (property.type === "object") return true;
  const nested = [
    ...((property.anyOf ?? []) as JsonSchemaObject[]),
    ...(property.items ? [property.items as JsonSchemaObject] : []),
  ];
  return nested.some(containsObjectType);
}
