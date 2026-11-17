import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolDefinition } from "../contracts/index.ts";
import { toyReadTool, toyWriteTool } from "../testing/index.ts";
import { checkArguments } from "./argument-repair.ts";
import { parseArgumentsLeniently } from "./lenient-json.ts";
import { ToolRegistry } from "./registry.ts";
import { toolSignature } from "./tool-schema.ts";

function toolWith(name: string, parameters: z.ZodObject, extra: Partial<ToolDefinition> = {}) {
  return {
    name,
    description: "A test tool.",
    parameters,
    permission: "read",
    resultTokenCap: 100,
    groups: ["core"],
    run: async () => ({ text: "" }),
    ...extra,
  } as ToolDefinition;
}

describe("ToolRegistry", () => {
  it("generates a compact JSON schema from the zod parameters", () => {
    const registry = new ToolRegistry([
      toolWith(
        "find",
        z.object({
          pattern: z.string().describe("Glob"),
          limit: z.number().int().positive().default(20),
        }),
      ),
    ]);
    expect(registry.get("find")?.schema).toEqual({
      name: "find",
      description: "A test tool.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob" },
          limit: { type: "integer", default: 20, exclusiveMinimum: 0 },
        },
        required: ["pattern"],
      },
    });
  });

  it("refuses a shell tool (PERM-6)", () => {
    expect(() => new ToolRegistry([toolWith("bash", z.object({}))])).toThrow(/PERM-6/);
    expect(() => new ToolRegistry([toolWith("run_command", z.object({}))])).toThrow(/PERM-6/);
  });

  it("refuses nested object parameters", () => {
    const nested = z.object({ options: z.object({ deep: z.boolean() }) });
    expect(() => new ToolRegistry([toolWith("nested", nested)])).toThrow(/flat/);
    const arrayOfObjects = z.object({ rows: z.array(z.object({ a: z.string() })) });
    expect(() => new ToolRegistry([toolWith("rows", arrayOfObjects)])).toThrow(/flat/);
  });

  it("refuses duplicates, bad names, and a write tool without a preview", () => {
    expect(
      () => new ToolRegistry([toyReadTool as ToolDefinition, toyReadTool as ToolDefinition]),
    ).toThrow(/twice/);
    expect(() => new ToolRegistry([toolWith("ReadFile", z.object({}))])).toThrow(/snake case/);
    expect(() => new ToolRegistry([toolWith("w", z.object({}), { permission: "write" })])).toThrow(
      /previewChange/,
    );
  });

  it("keeps registration order", () => {
    const registry = new ToolRegistry([
      toyWriteTool as ToolDefinition,
      toyReadTool as ToolDefinition,
    ]);
    expect(registry.names()).toEqual(["write_note", "read_note"]);
  });
});

describe("toolSignature", () => {
  it("describes optional, enum, nullable, and array parameters", () => {
    const tool = toolWith(
      "query",
      z.object({
        sql: z.string(),
        format: z.enum(["table", "csv"]).optional(),
        tags: z.array(z.string()).nullable(),
      }),
    );
    expect(toolSignature(tool)).toBe(
      'query(sql: string, format?: "table" | "csv", tags: string[])',
    );
  });
});

describe("parseArgumentsLeniently", () => {
  it.each([
    ['{"a":1}', { a: 1 }, false],
    ["", {}, false],
    ['```json\n{"a":1}\n```', { a: 1 }, true],
    ['Sure: {"a":1} done', { a: 1 }, true],
    ['{"a":[1,2,],}', { a: [1, 2] }, true],
    ['"{\\"a\\":1}"', { a: 1 }, true],
    ['{"a":"x,}"}', { a: "x,}" }, false],
  ])("parses %s", (text, value, repaired) => {
    expect(parseArgumentsLeniently(text)).toEqual({ ok: true, value, repaired });
  });

  it("gives up on text that is not an object", () => {
    expect(parseArgumentsLeniently("[1,2]")).toEqual({ ok: false });
    expect(parseArgumentsLeniently("{not json")).toEqual({ ok: false });
  });
});

describe("checkArguments", () => {
  const registry = new ToolRegistry([
    toolWith(
      "sample",
      z.object({
        path: z.string(),
        count: z.number().int().optional(),
        recursive: z.boolean().optional(),
        names: z.array(z.string()).optional(),
      }),
    ),
  ]);
  const tool = registry.get("sample");
  if (!tool) throw new Error("sample tool missing");

  it("accepts valid arguments unchanged", () => {
    expect(checkArguments(tool, '{"path":"a"}')).toEqual({
      ok: true,
      args: { path: "a" },
      repaired: false,
    });
  });

  it("repairs strings, case, single values, and extra fields", () => {
    const check = checkArguments(
      tool,
      '{"Path":"a","count":"5","recursive":"true","names":"x","extra":1}',
    );
    expect(check).toEqual({
      ok: true,
      args: { path: "a", count: 5, recursive: true, names: ["x"] },
      repaired: true,
    });
  });

  it("parses an array sent as a JSON string and a number sent for a string", () => {
    expect(checkArguments(tool, '{"path":7,"names":"[\\"x\\",\\"y\\"]"}')).toEqual({
      ok: true,
      args: { path: "7", names: ["x", "y"] },
      repaired: true,
    });
  });

  it("rejects what cannot be repaired with a corrective message", () => {
    const check = checkArguments(tool, '{"count":"many"}');
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.error).toMatch(
      /^Invalid arguments: "path" expected string, received undefined; "count" expected number, received string\./,
    );
    expect(check.error).toContain(
      "Expected sample(path: string, count?: integer, recursive?: boolean, names?: string[])",
    );
    expect(check.error).not.toMatch(/at .*\.ts/);
  });
});
