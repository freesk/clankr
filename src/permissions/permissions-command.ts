// `/permissions`: show and change the mode and the session grants (specs/permissions.md).

import type {
  PermissionMode,
  SessionGrants,
  SlashCommand,
  SlashCommandContext,
} from "../contracts/index.ts";

const modes: readonly PermissionMode[] = ["ask", "auto-edit", "read-only"];
const revokeWord = "revoke";

export const permissionsCommand: SlashCommand = {
  name: "permissions",
  summary: "Show or change the permission mode and this session's grants",
  usage: `/permissions [${modes.join("|")}|${revokeWord}]`,
  async run(argumentText, context) {
    const argument = argumentText.trim().toLowerCase();
    if (argument === "") {
      context.print(describePermissions(context));
    } else if (isPermissionMode(argument)) {
      context.session.permissionMode = argument;
      context.print(`Permission mode is now ${argument}.`);
    } else if (argument === revokeWord) {
      context.session.grants.tools.clear();
      context.session.grants.dataFiles.clear();
      context.print("All session grants revoked. The next change asks again.");
    } else {
      context.print(
        `Unknown argument "${argumentText.trim()}". Usage: ${permissionsCommand.usage}`,
      );
    }
  },
};

function describePermissions(context: SlashCommandContext): string {
  const { permissions } = context.config;
  const lines = [
    `Mode: ${context.session.permissionMode}`,
    "Allowed folders:",
    ...permissions.allowedRoots.map((root) => `  ${root}`),
    ...describeGrants(context.session.grants),
  ];
  if (permissions.extraDeniedPaths.length > 0) {
    lines.push("Protected paths added in config:");
    lines.push(...permissions.extraDeniedPaths.map((path) => `  ${path}`));
  }
  lines.push(`Change with ${permissionsCommand.usage}`);
  return lines.join("\n");
}

function describeGrants(grants: SessionGrants): string[] {
  if (grants.tools.size === 0 && grants.dataFiles.size === 0) {
    return ["Session grants: none"];
  }
  return [
    "Session grants:",
    ...[...grants.tools].map((tool) => `  tool ${tool}`),
    ...[...grants.dataFiles].map((dataFile) => `  code on ${dataFile}`),
  ];
}

function isPermissionMode(value: string): value is PermissionMode {
  return (modes as readonly string[]).includes(value);
}
