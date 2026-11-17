import { describe, expect, it } from "vitest";
import type {
  ChangePreview,
  GatedTool,
  PermissionMode,
  SessionGrants,
} from "../contracts/index.ts";
import { FixedPathPolicy, QueuedApprovalPrompter } from "../testing/index.ts";
import { SessionPermissionGate } from "./gate.ts";

const writeFile: GatedTool = { name: "write_file", permission: "write" };
const deleteTool: GatedTool = { name: "delete", permission: "write" };
const querySql: GatedTool = { name: "query_sql", permission: "execute" };
const makeChart: GatedTool = { name: "make_chart", permission: "execute" };
const readFile: GatedTool = { name: "read_file", permission: "read" };

const paths = new FixedPathPolicy({ allowedRoots: ["/work"], deniedPaths: ["/home/.ssh"] });

function session(mode: PermissionMode = "ask"): {
  permissionMode: PermissionMode;
  grants: SessionGrants;
} {
  return { permissionMode: mode, grants: { tools: new Set(), dataFiles: new Set() } };
}

function writePreview(...targetPaths: string[]): ChangePreview {
  return { summary: "Write a file", diff: "+hello", targetPaths };
}

function codePreview(dataFile: string, targetPaths: string[] = []): ChangePreview {
  return { summary: "Run a query", code: "SELECT 1", targetPaths, dataSourcePaths: [dataFile] };
}

describe("SessionPermissionGate", () => {
  it("lets reads through without asking", async () => {
    const prompter = new QueuedApprovalPrompter();
    const gate = new SessionPermissionGate({ session: session(), paths, prompter });
    expect(await gate.check(readFile, { path: "/work/a" })).toEqual({
      allowed: true,
      basis: "read",
    });
    expect(prompter.requests).toHaveLength(0);
  });

  it("refuses a read of a denied path in every mode, without asking", async () => {
    for (const mode of ["ask", "auto-edit", "read-only"] as const) {
      const prompter = new QueuedApprovalPrompter();
      const gate = new SessionPermissionGate({ session: session(mode), paths, prompter });
      const preview = { summary: "Read", targetPaths: ["/home/.ssh/id_ed25519"] };
      const decision = await gate.check(readFile, {}, preview);
      expect(decision).toMatchObject({
        allowed: false,
        feedback: expect.stringMatching(/protected/),
      });
      expect(prompter.requests).toHaveLength(0);
    }
  });

  it("shows the preview and the reason when it asks", async () => {
    const prompter = new QueuedApprovalPrompter([{ kind: "once" }]);
    const gate = new SessionPermissionGate({ session: session(), paths, prompter });
    const preview = writePreview("/work/a.md");
    expect(await gate.check(writeFile, {}, preview)).toEqual({
      allowed: true,
      basis: "approved-once",
    });
    expect(prompter.requests[0]).toEqual({
      tool: writeFile,
      preview,
      reason: "ask mode confirms each change",
    });
  });

  it("asks again after 'once', and not after 'always for this session'", async () => {
    const state = session();
    const prompter = new QueuedApprovalPrompter([{ kind: "once" }, { kind: "session" }]);
    const gate = new SessionPermissionGate({ session: state, paths, prompter });
    await gate.check(writeFile, {}, writePreview("/work/a.md"));
    await gate.check(writeFile, {}, writePreview("/work/a.md"));
    expect(await gate.check(writeFile, {}, writePreview("/work/b.md"))).toEqual({
      allowed: true,
      basis: "grant",
    });
    expect(prompter.requests).toHaveLength(2);

    // A new session starts with no grants.
    const nextPrompter = new QueuedApprovalPrompter([{ kind: "once" }]);
    const nextGate = new SessionPermissionGate({
      session: session(),
      paths,
      prompter: nextPrompter,
    });
    await nextGate.check(writeFile, {}, writePreview("/work/c.md"));
    expect(nextPrompter.requests).toHaveLength(1);
  });

  it("covers later queries and charts on a granted data file, but not another file (D19)", async () => {
    const prompter = new QueuedApprovalPrompter([{ kind: "session" }, { kind: "once" }]);
    const gate = new SessionPermissionGate({ session: session(), paths, prompter });
    await gate.check(querySql, {}, codePreview("/work/payroll.xlsx"));
    expect(await gate.check(querySql, {}, codePreview("/work/payroll.xlsx"))).toMatchObject({
      allowed: true,
    });
    const chart = codePreview("/work/payroll.xlsx", ["/work/payroll-chart.pdf"]);
    expect(await gate.check(makeChart, {}, chart)).toMatchObject({ allowed: true });
    expect(prompter.requests).toHaveLength(1);

    await gate.check(querySql, {}, codePreview("/work/other.csv"));
    expect(prompter.requests).toHaveLength(2);
    expect(prompter.requests[1]?.reason).toMatch(/other\.csv/);
  });

  it("still asks for a chart written outside the roots when its data is granted", async () => {
    const state = session();
    state.grants.dataFiles.add("/work/payroll.xlsx");
    const prompter = new QueuedApprovalPrompter([{ kind: "session" }]);
    const gate = new SessionPermissionGate({ session: state, paths, prompter });
    await gate.check(makeChart, {}, codePreview("/work/payroll.xlsx", ["/tmp/chart.pdf"]));
    expect(prompter.requests[0]?.reason).toMatch(/outside the allowed folders/);
    // "Always" on an outside write grants nothing, so the next one asks again.
    await expect(
      gate.check(makeChart, {}, codePreview("/work/payroll.xlsx", ["/tmp/chart.pdf"])),
    ).rejects.toThrow(/no answer queued/);
  });

  it("asks for delete in auto-edit mode until granted (D20)", async () => {
    const prompter = new QueuedApprovalPrompter([{ kind: "session" }]);
    const gate = new SessionPermissionGate({ session: session("auto-edit"), paths, prompter });
    await gate.check(deleteTool, {}, writePreview("/work/a.md"));
    await gate.check(deleteTool, {}, writePreview("/work/b.md"));
    expect(prompter.requests).toHaveLength(1);
    expect(prompter.requests[0]?.reason).toBe("delete always asks");
  });

  it("returns the user's feedback as the denial text", async () => {
    const prompter = new QueuedApprovalPrompter([{ kind: "deny", feedback: "use notes/ instead" }]);
    const gate = new SessionPermissionGate({ session: session(), paths, prompter });
    expect(await gate.check(writeFile, {}, writePreview("/work/a.md"))).toEqual({
      allowed: false,
      feedback: "The user denied write_file. Their feedback: use notes/ instead",
    });
  });

  it("reads a mode change from /permissions on the next call", async () => {
    const state = session("auto-edit");
    const gate = new SessionPermissionGate({ session: state, paths });
    expect((await gate.check(writeFile, {}, writePreview("/work/a.md"))).allowed).toBe(true);
    state.permissionMode = "read-only";
    expect(await gate.check(writeFile, {}, writePreview("/work/a.md"))).toMatchObject({
      allowed: false,
      feedback: expect.stringMatching(/read-only/),
    });
  });

  it("ignores grant-shaped arguments: only the user's answer grants (SEC-7)", async () => {
    const state = session();
    const gate = new SessionPermissionGate({ session: state, paths });
    const args = { grant: "session", permissionMode: "auto-edit", approved: true };
    expect((await gate.check(writeFile, args, writePreview("/work/a.md"))).allowed).toBe(false);
    expect(state.grants.tools.size).toBe(0);
  });
});

describe("one-shot mode, with no prompter (D14)", () => {
  it("denies a write that would ask, pointing at --permission-mode auto-edit", async () => {
    const gate = new SessionPermissionGate({ session: session("ask"), paths });
    const decision = await gate.check(writeFile, {}, writePreview("/work/a.md"));
    expect(decision).toMatchObject({ allowed: false });
    if (decision.allowed) return;
    expect(decision.feedback).toMatch(/--permission-mode auto-edit to allow/);
  });

  it("allows that write when auto-edit was passed", async () => {
    const gate = new SessionPermissionGate({ session: session("auto-edit"), paths });
    expect((await gate.check(writeFile, {}, writePreview("/work/a.md"))).allowed).toBe(true);
  });

  it("points a refused query at --allow-data, not --permission-mode (D74)", async () => {
    const gate = new SessionPermissionGate({ session: session("auto-edit"), paths });
    const decision = await gate.check(querySql, {}, codePreview("/work/payroll.xlsx"));
    if (decision.allowed) throw new Error("expected a denial");
    expect(decision.feedback).toMatch(/rerun with --allow-data/);
    expect(decision.feedback).not.toMatch(/--permission-mode/);
  });

  it("allows a query on a data file inside the allowed folders with --allow-data", async () => {
    const gate = new SessionPermissionGate({
      session: session("ask"),
      paths,
      runGrants: { dataInAllowedFolders: true },
    });
    const decision = await gate.check(querySql, {}, codePreview("/work/payroll.xlsx"));
    expect(decision).toEqual({ allowed: true, basis: "grant" });
  });

  it("still refuses a data file outside the allowed folders with --allow-data", async () => {
    const gate = new SessionPermissionGate({
      session: session("ask"),
      paths,
      runGrants: { dataInAllowedFolders: true },
    });
    const decision = await gate.check(querySql, {}, codePreview("/elsewhere/payroll.xlsx"));
    if (decision.allowed) throw new Error("expected a denial");
    expect(decision.feedback).toMatch(/run vix interactively/);
  });
});
