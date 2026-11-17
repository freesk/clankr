// CTX-5: system prompt plus core tool definitions must fit 1,500 tokens.
//
// The real core tools belong to other parts and the real token counter needs LM Studio, so
// this measures stand-ins shaped like the PRD Appendix B core tools with the fake counter
// (4 characters per token). Integration repeats the measurement with the real tools and
// counter through measureFixedOverhead.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolDefinition } from "../contracts/index.ts";
import { ScriptedLmClient } from "../testing/index.ts";
import { measureFixedOverhead } from "./fixed-overhead.ts";

const fixedOverheadBudget = 1_500;

const preview = async () => ({ summary: "", targetPaths: [] });

function standIn(
  name: string,
  description: string,
  shape: z.ZodRawShape,
  permission: ToolDefinition["permission"] = "read",
): ToolDefinition {
  return {
    name,
    description,
    parameters: z.object(shape),
    permission,
    resultTokenCap: 800,
    groups: ["core"],
    ...(permission === "read" ? {} : { previewChange: preview }),
    run: async () => ({ text: "" }),
  } as ToolDefinition;
}

const path = z.string().describe("File or folder path");

const coreStandIns: ToolDefinition[] = [
  standIn(
    "find_files",
    "Find files by name, kind, or date using Spotlight. Searches the home folder unless a folder is given.",
    {
      query: z.string().describe("Name pattern or words"),
      folder: z.string().optional(),
      kind: z.enum(["any", "document", "image", "spreadsheet", "pdf", "folder"]).optional(),
      modified_within_days: z.number().int().positive().optional(),
      limit: z.number().int().positive().default(50),
    },
  ),
  standIn("search_content", "Search inside files for text or a regular expression.", {
    pattern: z.string(),
    folder: z.string().optional(),
    glob: z.string().optional(),
    case_sensitive: z.boolean().optional(),
    limit: z.number().int().positive().default(50),
  }),
  standIn("list_dir", "List a folder's contents with sizes and dates.", {
    path,
    recursive: z.boolean().optional(),
  }),
  standIn("read_file", "Read a text file by line range.", {
    path,
    start_line: z.number().int().positive().default(1),
    line_count: z.number().int().positive().default(200),
  }),
  standIn("read_result", "Page through or search a stored result by its handle.", {
    handle: z.string().describe("For example r12"),
    start_line: z.number().int().positive().optional(),
    line_count: z.number().int().positive().optional(),
    search: z.string().optional(),
  }),
  standIn(
    "write_file",
    "Create or overwrite a text file. Read an existing file first.",
    { path, content: z.string() },
    "write",
  ),
  standIn(
    "edit_file",
    "Replace an exact string in a file. The old text must appear once.",
    {
      path,
      old_text: z.string(),
      new_text: z.string(),
    },
    "write",
  ),
  standIn("make_dir", "Create a folder, including missing parents.", { path }, "write"),
  standIn(
    "move",
    "Move or rename a file or folder.",
    { source: z.string(), destination: z.string() },
    "write",
  ),
  standIn(
    "copy",
    "Copy a file or folder.",
    { source: z.string(), destination: z.string() },
    "write",
  ),
  standIn("delete", "Move a file or folder to the Trash.", { path }, "write"),
  standIn(
    "delegate",
    "Hand a broad task to a sub-agent with a fresh context. The brief must be self-contained.",
    {
      brief: z.string(),
    },
  ),
];

describe("fixed overhead (CTX-5)", () => {
  for (const style of ["native", "prompt"] as const) {
    it(`fits the budget in the ${style} style`, async () => {
      const tokens = await measureFixedOverhead({
        lm: new ScriptedLmClient(),
        tools: coreStandIns,
        workingDirectory: "/Users/someone/Documents/projects",
        style,
      });
      // Logged so the number is visible in the test output, not only pass or fail.
      console.log(
        `fixed overhead, ${style} style, ${coreStandIns.length} core tools: ${tokens} tokens`,
      );
      expect(tokens).toBeLessThanOrEqual(fixedOverheadBudget);
    });
  }
});
