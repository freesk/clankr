// permissions part. See specs/permissions.md. Decides whether a tool call may run.

export {
  type AuditLogOptions,
  createAuditLog,
  DiscardingAuditLog,
  FileAuditLog,
  maxLoggedStringLength,
} from "./audit-log.ts";
export { canonicalPath, comparisonKey, expandHome, isSameOrInside } from "./canonical-path.ts";
export { deleteToolName } from "./decision.ts";
export { defaultDeniedPaths, deniedFileNames } from "./deny-list.ts";
export { SessionPermissionGate, type SessionPermissionGateOptions } from "./gate.ts";
export { type PathPolicyOptions, RealPathPolicy } from "./path-policy.ts";
export { permissionsCommand } from "./permissions-command.ts";
