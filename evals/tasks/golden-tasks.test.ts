// The golden tasks are valid, cover every scenario, and their expected answers
// match what the fixture generators produce.

import { describe, expect, it } from "vitest";
import { boardReport, datasets } from "../fixtures/datasets.ts";
import { loadGoldenTasks } from "./load.ts";
import { type GoldenTask, scenarioIds } from "./schema.ts";
import { plannedToolNames } from "./tool-inventory.ts";

const tasks = await loadGoldenTasks();

function task(id: string): GoldenTask {
  const found = tasks.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no golden task ${id}`);
  return found;
}

function expectedNumbers(id: string): number[] {
  return task(id).assertions.flatMap((assertion) =>
    assertion.kind === "answer-number" ? [assertion.value] : [],
  );
}

describe("golden tasks", () => {
  it("has about 40 tasks covering S1 to S10", () => {
    expect(tasks.length).toBeGreaterThanOrEqual(38);
    expect(tasks.length).toBeLessThanOrEqual(45);
    expect(new Set(tasks.map((candidate) => candidate.scenario))).toEqual(new Set(scenarioIds));
  });

  it("requires only tools from the v1 inventory, or slash commands", () => {
    const known = new Set<string>(plannedToolNames);
    for (const candidate of tasks) {
      for (const requirement of candidate.requires) {
        expect(known.has(requirement) || requirement.startsWith("command:"), requirement).toBe(
          true,
        );
      }
    }
  });

  it("marks exactly the make_chart tasks as chart tasks", () => {
    for (const candidate of tasks) {
      expect(candidate.chart, candidate.id).toBe(candidate.requires.includes("make_chart"));
    }
  });
});

describe("expected answers match the generated data", () => {
  const payroll = [...datasets.payroll.rows()];

  it("payroll facts", () => {
    expect(expectedNumbers("s7-payroll-overview")).toEqual([payroll.length]);
    const engineering = payroll.filter((row) => row.department === "Engineering");
    expect(expectedNumbers("s7-engineering-headcount")).toEqual([engineering.length]);
    const total = payroll.reduce((sum, row) => sum + Number(row.annual_salary), 0);
    expect(expectedNumbers("s7-total-payroll")).toEqual([total]);
    const top = payroll.reduce((best, row) =>
      Number(row.annual_salary) > Number(best.annual_salary) ? row : best,
    );
    expect(expectedNumbers("s7-highest-paid")).toEqual([top.annual_salary]);
    expect(JSON.stringify(task("s7-highest-paid").assertions)).toContain(String(top.name));
  });

  it("the 1,000,000-row sales facts, computed from the rows without writing the file", () => {
    let rows = 0;
    let northQuantity = 0;
    for (const row of datasets.sales.rows(1_000_000)) {
      rows++;
      if (row.region === "North") northQuantity += Number(row.quantity);
    }
    expect(expectedNumbers("s7-million-row-aggregate")).toEqual([rows, northQuantity]);
  });

  it("board report total headcount", () => {
    const offices = boardReport.tables[1]?.rows ?? [];
    const total = offices.reduce((sum, [, headcount]) => sum + Number(headcount), 0);
    expect(expectedNumbers("s9-headcount-by-office")).toEqual([total]);
  });
});
