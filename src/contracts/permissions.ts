// Gating tool calls and classifying paths (seams: permissions → agent-loop and the tool parts;
// cli → permissions for approval prompts).

import type { PermissionClass } from "./tools.ts";

export type PermissionMode = "ask" | "auto-edit" | "read-only";

/**
 * What a write or execute tool is about to do (FS-7). Built by the tool,
 * judged by permissions, drawn by the cli.
 */
export interface ChangePreview {
  /** One line, for example "Move 12 files into Pictures/Screenshots". */
  summary: string;
  /** Unified diff, for edits and overwrites. */
  diff?: string;
  /** SQL or JavaScript about to run, for execute-class tools. */
  code?: string;
  /** Every path the change writes to. Permissions classifies each one. */
  targetPaths: string[];
  /** Data files the code reads. Execute-class grants are keyed by these (D19). */
  dataSourcePaths?: string[];
}

export type GateDecision = { allowed: true } | { allowed: false; feedback: string };

export interface GatedTool {
  name: string;
  permission: PermissionClass;
}

export interface PermissionGate {
  check(
    tool: GatedTool,
    args: Record<string, unknown>,
    preview?: ChangePreview,
  ): Promise<GateDecision>;
}

export type PathClass = "allowed" | "outside" | "denied";

export interface PathClassification {
  /** Canonical path: `~` expanded, relative segments and symbolic links resolved. */
  realPath: string;
  pathClass: PathClass;
}

export interface PathPolicy {
  classify(path: string): Promise<PathClassification>;
}

export interface ApprovalRequest {
  tool: GatedTool;
  preview: ChangePreview;
  /** Why the gate is asking, for example "outside the allowed folders". */
  reason: string;
}

export type ApprovalAnswer =
  | { kind: "once" }
  | { kind: "session" }
  | { kind: "deny"; feedback?: string };

export interface ApprovalPrompter {
  ask(request: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalAnswer>;
}
