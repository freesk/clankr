import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.ts";
import { type ToolContext, ToolError } from "../contracts/index.ts";
import { createTestToolContext, type TestToolContext } from "../testing/index.ts";
import { DiskResultStore } from "./disk-result-store.ts";
import { createReadResultTool } from "./read-result-tool.ts";

const tool = createReadResultTool(defaultConfig());
const lines = Array.from({ length: 1_000 }, (_, index) => `line ${index + 1} of the listing`);

let testContext: TestToolContext;
let context: ToolContext;
let handle: string;

beforeEach(async () => {
  testContext = await createTestToolContext();
  const results = new DiskResultStore(testContext.context.clankrPaths.session.results);
  context = { ...testContext.context, results };
  handle = await results.putText(lines.join("\n"), {
    tool: "list_dir",
    arguments: { path: "." },
    label: "list_dir .",
  });
});

afterEach(async () => {
  await testContext.cleanup();
});

async function read(args: Record<string, unknown>): Promise<string> {
  return (await tool.run(tool.parameters.parse(args), context)).text;
}

async function tokens(text: string): Promise<number> {
  return context.lm.countTokens([{ role: "user", content: text }]);
}

describe("read_result", () => {
  it("is a core read tool", () => {
    expect(tool.permission).toBe("read");
    expect(tool.groups).toEqual(["core"]);
    expect(tool.resultTokenCap).toBe(defaultConfig().context.defaultResultTokenCap);
  });

  it("reads a page within its own cap and says where to continue", async () => {
    const page = await read({ handle });
    expect(page).toContain("1: line 1 of the listing");
    expect(await tokens(page)).toBeLessThanOrEqual(tool.resultTokenCap);
    const next = /Continue with start_line (\d+)/.exec(page)?.[1];
    expect(Number(next)).toBeGreaterThan(10);

    const second = await read({ handle, start_line: Number(next) });
    expect(second).toContain(`${next}: line ${next} of the listing`);
  });

  it("honours an explicit line range and reports the end", async () => {
    const page = await read({ handle, start_line: 998, line_count: 5 });
    expect(page).toContain("lines 998-1000");
    expect(page).toContain("1000: line 1000 of the listing");
    expect(page).toContain("End of result.");
    const short = await read({ handle, start_line: 10, line_count: 2 });
    expect(short).toContain("lines 10-11");
    expect(short).toContain("Continue with start_line 12.");
  });

  it("searches case-insensitively and pages through matches", async () => {
    const page = await read({ handle, search: "LINE 99" });
    expect(page).toContain("99: line 99 of the listing");
    expect(page).toContain("990: line 990 of the listing");
    expect(page).not.toContain("98: line 98");
    expect(page).toContain("No more matches.");

    const empty = await read({ handle, search: "nothing like this" });
    expect(empty).toContain('no lines contain "nothing like this"');
  });

  it("reads row sets as one JSON row per line", async () => {
    const rowsHandle = await context.results.putRows(
      [
        { city: "Oslo", sales: 3 },
        { city: "Lima", sales: 5 },
      ],
      { tool: "query_sql", arguments: { sql: "select" } },
    );
    const page = await read({ handle: rowsHandle, search: "lima" });
    expect(page).toContain('2: {"city":"Lima","sales":5}');
  });

  it("explains an unknown or malformed handle", async () => {
    await expect(read({ handle: "r404" })).rejects.toBeInstanceOf(ToolError);
    await expect(read({ handle: "../etc/passwd" })).rejects.toThrow(/Handles look like r12/);
    await expect(read({ handle, start_line: 5_000 })).rejects.toThrow(/has 1000 lines/);
  });
});
