// The data path end to end (PRD 5.7): inspect_data, query_sql, and make_chart with the real
// DuckDB engine, isolate, chart validation, and offline browser, producing a PDF. Driven
// through the real harness with a prompter that grants for the session, as a REPL user would.

import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentEvent, ChatRequest } from "../../src/contracts/index.ts";
import { isBrowserVendored } from "../../src/engines/browser/index.ts";
import { QueuedApprovalPrompter, respond } from "../../src/testing/index.ts";
import { createIntegrationKit, type IntegrationKit, lastToolResult } from "./integration-kit.ts";

let kit: IntegrationKit | undefined;

afterEach(async () => {
  await kit?.cleanup();
  kit = undefined;
});

const salesCsv = [
  "department,amount",
  ...Array.from({ length: 300 }, (_, index) => `dept_${index % 3},${index}`),
].join("\n");

/** The chart code the "model" writes, using the handle query_sql just returned. */
function chartCall(request: ChatRequest) {
  const handle = /Full result: (r\d+)/.exec(lastToolResult(request.messages))?.[1] ?? "missing";
  const code = [
    "const spec = {",
    '  title: "Total by department",',
    '  mark: "bar",',
    "  encoding: {",
    '    x: { field: "department", type: "nominal" },',
    '    y: { field: "total", type: "quantitative" },',
    "  },",
    "};",
    `render(spec, data("${handle}"));`,
  ].join("\n");
  return respond.toolCall("make_chart", { code });
}

describe.skipIf(!(await isBrowserVendored()))("data turn", () => {
  it("inspects a CSV, aggregates it with SQL, and saves a PDF chart beside it", async () => {
    kit = await createIntegrationKit({
      responses: [
        respond.toolCall("inspect_data", { path: "sales.csv" }),
        respond.toolCall("query_sql", {
          sql: "SELECT department, SUM(amount) AS total FROM sales GROUP BY department ORDER BY department",
        }),
        chartCall,
        // The vision self-check (DATA-18) asks the same model about a preview.
        respond.text("PASS The bars and labels are readable."),
        respond.text("Saved the chart."),
      ],
    });
    const csvPath = join(kit.workingDirectory, "sales.csv");
    await writeFile(csvPath, `${salesCsv}\n`);
    const prompter = new QueuedApprovalPrompter([{ kind: "session" }]);
    const config = await kit.composition.loadConfig({
      flags: {},
      workingDirectory: kit.workingDirectory,
      environment: {},
    });
    const harness = await kit.composition.openHarness({
      config,
      approvalPrompter: prompter,
      ephemeral: false,
      resume: false,
      workingDirectory: kit.workingDirectory,
    });

    const events: AgentEvent[] = [];
    try {
      const turn = harness.runTurn(
        { text: `Chart total amount by department from ${csvPath}` },
        new AbortController().signal,
      );
      for await (const event of turn) events.push(event);
    } finally {
      await harness.close();
    }

    const ends = events.filter((event) => event.type === "tool-end");
    expect(ends.map((event) => ("error" in event ? event.error : undefined))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(events.at(-1)).toEqual({ type: "turn-end", reason: "done" });
    // One prompt for the data file covers the query and the chart (D19).
    expect(prompter.requests.map((request) => request.tool.name)).toEqual(["query_sql"]);

    const chartResult = lastToolResult(kit.lm.requests.at(-1)?.messages ?? []);
    const pdfPath = /Saved chart: (\S+\.pdf)/.exec(chartResult)?.[1];
    // D28: beside the data file. Paths are canonical (/var is /private/var on macOS).
    expect(pdfPath?.startsWith(await realpath(kit.workingDirectory))).toBe(true);
    const pdf = await readFile(pdfPath ?? "");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await stat(pdfPath ?? "")).size).toBeGreaterThan(1000);
    expect(chartResult).toContain("Self-check passed");
  });
});
