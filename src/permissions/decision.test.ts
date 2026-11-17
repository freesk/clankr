// Every cell of the decision table in specs/permissions.md, plus the deny-list row.

import { describe, expect, it } from "vitest";
import type { GatedTool, PathClass, PermissionMode, SessionGrants } from "../contracts/index.ts";
import { type ClassifiedChange, decide } from "./decision.ts";

const readTool: GatedTool = { name: "read_file", permission: "read" };
const writeTool: GatedTool = { name: "write_file", permission: "write" };
const deleteTool: GatedTool = { name: "delete", permission: "write" };
const executeTool: GatedTool = { name: "query_sql", permission: "execute" };

function noGrants(): SessionGrants {
  return { tools: new Set(), dataFiles: new Set() };
}

function change(targetClass: PathClass | undefined, dataClass?: PathClass): ClassifiedChange {
  return {
    targets: targetClass ? [{ realPath: `/t/${targetClass}`, pathClass: targetClass }] : [],
    dataSources: dataClass ? [{ realPath: `/d/${dataClass}.csv`, pathClass: dataClass }] : [],
    previewMissing: false,
  };
}

type Cell = [PermissionMode, string, GatedTool, ClassifiedChange, string];

// [mode, column, tool, change, expected verdict kind]
const table: Cell[] = [
  ["ask", "read", readTool, change("allowed"), "allow"],
  ["ask", "write inside", writeTool, change("allowed"), "ask"],
  ["ask", "write outside", writeTool, change("outside"), "ask"],
  ["ask", "delete", deleteTool, change("allowed"), "ask"],
  ["ask", "execute", executeTool, change(undefined, "allowed"), "ask"],
  ["auto-edit", "read", readTool, change("allowed"), "allow"],
  ["auto-edit", "write inside", writeTool, change("allowed"), "allow"],
  ["auto-edit", "write outside", writeTool, change("outside"), "ask"],
  ["auto-edit", "delete", deleteTool, change("allowed"), "ask"],
  ["auto-edit", "execute", executeTool, change(undefined, "allowed"), "ask"],
  ["read-only", "read", readTool, change("allowed"), "allow"],
  ["read-only", "write inside", writeTool, change("allowed"), "refuse-read-only"],
  ["read-only", "write outside", writeTool, change("outside"), "refuse-read-only"],
  ["read-only", "delete", deleteTool, change("allowed"), "refuse-read-only"],
  ["read-only", "execute", executeTool, change(undefined, "allowed"), "refuse-read-only"],
];

describe("decision table", () => {
  it.each(table)("%s mode, %s", (mode, _column, tool, classified, expected) => {
    expect(decide(tool, mode, noGrants(), classified).kind).toBe(expected);
  });

  const modes: PermissionMode[] = ["ask", "auto-edit", "read-only"];
  const tools = [readTool, writeTool, deleteTool, executeTool];
  it.each(modes)("refuses a denied path in %s mode for every class, without asking", (mode) => {
    for (const tool of tools) {
      expect(decide(tool, mode, noGrants(), change("denied")).kind).toBe("refuse-denied-path");
      expect(decide(tool, mode, noGrants(), change(undefined, "denied")).kind).toBe(
        "refuse-denied-path",
      );
    }
  });
});

describe("session grants", () => {
  it("cover delete and execute in auto-edit mode (D20, D19)", () => {
    const grants: SessionGrants = {
      tools: new Set(["delete"]),
      dataFiles: new Set(["/d/allowed.csv"]),
    };
    expect(decide(deleteTool, "auto-edit", grants, change("allowed"))).toEqual({
      kind: "allow",
      basis: "grant",
    });
    expect(decide(executeTool, "auto-edit", grants, change(undefined, "allowed")).kind).toBe(
      "allow",
    );
  });

  it("match data files case-insensitively", () => {
    const grants: SessionGrants = { tools: new Set(), dataFiles: new Set(["/D/ALLOWED.CSV"]) };
    expect(decide(executeTool, "ask", grants, change(undefined, "allowed")).kind).toBe("allow");
  });

  it("never cover a write outside the allowed roots", () => {
    const grants: SessionGrants = { tools: new Set(["write_file"]), dataFiles: new Set() };
    const verdict = decide(writeTool, "ask", grants, change("outside"));
    expect(verdict).toMatchObject({ kind: "ask", grantable: { tools: [], dataFiles: [] } });
  });

  it("let a granted data file cover a chart, but not its output outside the roots", () => {
    const chart: GatedTool = { name: "make_chart", permission: "execute" };
    const grants: SessionGrants = { tools: new Set(), dataFiles: new Set(["/d/allowed.csv"]) };
    expect(decide(chart, "ask", grants, change("allowed", "allowed")).kind).toBe("allow");
    expect(decide(chart, "ask", grants, change("outside", "allowed")).kind).toBe("ask");
  });

  it("fall back to a tool grant for code that reads no data file", () => {
    const runJs: GatedTool = { name: "run_js", permission: "execute" };
    expect(decide(runJs, "ask", noGrants(), change(undefined))).toMatchObject({
      kind: "ask",
      grantable: { tools: ["run_js"] },
    });
  });
});

describe("run grants (D74, --allow-data)", () => {
  const allowData = { dataInAllowedFolders: true };

  it("allows execute on a data file inside the allowed folders", () => {
    const verdict = decide(executeTool, "ask", noGrants(), change(undefined, "allowed"), allowData);
    expect(verdict).toEqual({ kind: "allow", basis: "grant" });
  });

  it("still asks for a data file outside the allowed folders", () => {
    const verdict = decide(executeTool, "ask", noGrants(), change(undefined, "outside"), allowData);
    expect(verdict.kind).toBe("ask");
  });

  it("does not cover writes or delete", () => {
    expect(decide(writeTool, "ask", noGrants(), change("allowed"), allowData).kind).toBe("ask");
    expect(decide(deleteTool, "auto-edit", noGrants(), change("allowed"), allowData).kind).toBe(
      "ask",
    );
  });

  it("does not override read-only", () => {
    const verdict = decide(
      executeTool,
      "read-only",
      noGrants(),
      change(undefined, "allowed"),
      allowData,
    );
    expect(verdict.kind).toBe("refuse-read-only");
  });
});

describe("missing preview", () => {
  it("asks even in auto-edit mode, since the targets are unknown", () => {
    const classified = { ...change(undefined), previewMissing: true };
    expect(decide(writeTool, "auto-edit", noGrants(), classified).kind).toBe("ask");
  });
});

it("reports auto-edit as the basis for a write it allows", () => {
  expect(decide(writeTool, "auto-edit", noGrants(), change("allowed"))).toEqual({
    kind: "allow",
    basis: "mode",
  });
});
