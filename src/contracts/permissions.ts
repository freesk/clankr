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

/**
 * Why a call was allowed, for the audit log: a read, the mode (auto-edit inside the
 * allowed roots), an earlier session grant, or the user's answer to this prompt.
 */
export type ApprovalBasis = "read" | "mode" | "grant" | "approved-once" | "approved-for-session";

export type GateDecision =
  | { allowed: true; basis?: ApprovalBasis }
  | { allowed: false; feedback: string };

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

/**
 * One line of the audit log (PERM-8): one per tool call, written after the call ends.
 * The agent loop writes it, because only it knows the outcome. The writer adds the time.
 */
export interface AuditEntry {
  tool: string;
  arguments: Record<string, unknown>;
  decision: "allowed" | "denied";
  basis?: ApprovalBasis;
  /** "not-run" when the gate denied the call. */
  outcome: "ok" | "error" | "not-run";
  /** The error text the model saw, when the outcome is "error". */
  error?: string;
  durationMs?: number;
}

/** Writes nothing in an ephemeral session. Never writes the API token. */
export interface AuditLog {
  record(entry: AuditEntry): Promise<void>;
}
