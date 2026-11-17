// Everything that belongs to one session and is replaced by `/clear`: its storage, result
// store, context engine, data registry, read tracker, audit log, and permission gate.

import { createContextCommands, DiskResultStore, VixContextEngine } from "../context/index.ts";
import type {
  ApprovalPrompter,
  AuditLog,
  Config,
  LmClient,
  LoadedModel,
  PermissionGate,
  SessionState,
  SessionTranscript,
  SlashCommand,
  VixPaths,
} from "../contracts/index.ts";
import { SessionDataSourceRegistry } from "../data/index.ts";
import { closeSessionEngine } from "../engines/duckdb/index.ts";
import { createAuditLog, RealPathPolicy, SessionPermissionGate } from "../permissions/index.ts";
import { openSession } from "../storage/index.ts";
import { createFileSlashCommands, type FileToolDependencies } from "../tools/fs/index.ts";
import { SessionReadTracker } from "../tools/search/index.ts";

export interface SessionRuntimeOptions {
  root: string;
  ephemeral: boolean;
  resumeSessionId?: string;
  config: Config;
  lm: LmClient;
  workingDirectory: string;
  /** Live session state: the gate reads the mode and grants from it on every call. */
  session: SessionState;
  model?: LoadedModel;
  approvalPrompter: ApprovalPrompter;
  fileTools: FileToolDependencies;
  homeDirectory?: string;
}

export interface SessionRuntime {
  paths: VixPaths;
  transcript: SessionTranscript;
  results: DiskResultStore;
  context: VixContextEngine;
  dataSources: SessionDataSourceRegistry;
  readTracker: SessionReadTracker;
  pathPolicy: RealPathPolicy;
  audit: AuditLog;
  permissions: PermissionGate;
  /** `/context`, `/compact`, and `/undo`, bound to this session's engine and snapshots. */
  slashCommands: SlashCommand[];
  close(): Promise<void>;
}

export async function openSessionRuntime(options: SessionRuntimeOptions): Promise<SessionRuntime> {
  const storage = await openSession({
    root: options.root,
    ephemeral: options.ephemeral,
    ...(options.resumeSessionId ? { resumeSessionId: options.resumeSessionId } : {}),
  });
  const paths = storage.paths;
  const results = new DiskResultStore(paths.session.results);
  const context = new VixContextEngine({
    lm: options.lm,
    results,
    config: options.config,
    ...(options.model ? { model: options.model } : {}),
  });
  const dataSources = new SessionDataSourceRegistry();
  const pathPolicy = new RealPathPolicy({
    allowedRoots: options.config.permissions.allowedRoots,
    extraDeniedPaths: options.config.permissions.extraDeniedPaths,
    vixRoot: paths.root,
    workingDirectory: options.workingDirectory,
    ...(options.homeDirectory ? { homeDirectory: options.homeDirectory } : {}),
  });
  const audit = createAuditLog({
    vixPaths: paths,
    ephemeral: options.ephemeral,
    secrets: [options.config.lmStudio.apiToken],
  });
  const permissions = new SessionPermissionGate({
    session: options.session,
    paths: pathPolicy,
    prompter: options.approvalPrompter,
  });
  return {
    paths,
    transcript: storage.transcript,
    results,
    context,
    dataSources,
    readTracker: new SessionReadTracker(),
    pathPolicy,
    audit,
    permissions,
    slashCommands: [
      ...createContextCommands(context),
      ...createFileSlashCommands(paths, options.fileTools),
    ],
    async close() {
      closeSessionEngine(dataSources);
      await storage.close();
    },
  };
}
