import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.ts";
import type { SessionState, SlashCommandContext } from "../contracts/index.ts";
import { ScriptedLmClient } from "../testing/index.ts";
import { permissionsCommand } from "./permissions-command.ts";

function commandContext(): { context: SlashCommandContext; printed: string[] } {
  const printed: string[] = [];
  const config = defaultConfig();
  config.permissions.allowedRoots = ["/work"];
  const session: SessionState = {
    id: "s1",
    messages: [],
    model: undefined,
    permissionMode: "ask",
    grants: { tools: new Set(["delete"]), dataFiles: new Set(["/work/payroll.xlsx"]) },
    reasoning: "off",
    ephemeral: false,
  };
  const context: SlashCommandContext = {
    session,
    config,
    lm: new ScriptedLmClient(),
    print: (text) => printed.push(text),
  };
  return { context, printed };
}

describe("/permissions", () => {
  it("shows the mode, the allowed folders, and the grants", async () => {
    const { context, printed } = commandContext();
    await permissionsCommand.run("", context);
    expect(printed[0]).toContain("Mode: ask");
    expect(printed[0]).toContain("  /work");
    expect(printed[0]).toContain("tool delete");
    expect(printed[0]).toContain("code on /work/payroll.xlsx");
  });

  it("changes the mode", async () => {
    const { context } = commandContext();
    await permissionsCommand.run(" Auto-Edit ", context);
    expect(context.session.permissionMode).toBe("auto-edit");
  });

  it("revokes every session grant", async () => {
    const { context } = commandContext();
    await permissionsCommand.run("revoke", context);
    expect(context.session.grants.tools.size + context.session.grants.dataFiles.size).toBe(0);
  });

  it("explains an unknown argument and changes nothing", async () => {
    const { context, printed } = commandContext();
    await permissionsCommand.run("yolo", context);
    expect(printed[0]).toMatch(/Unknown argument "yolo"\. Usage: \/permissions/);
    expect(context.session.permissionMode).toBe("ask");
  });
});
