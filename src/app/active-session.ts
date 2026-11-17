// One session as the harness holds it: the shared SessionState, its SessionRuntime, and the
// transcript sync. Opened at startup (new or `--resume`) and again by `/clear` (D32).
// Storage is opened only after the model is connected, so a failed start writes nothing.

import type { HarnessOptions } from "../cli/harness.ts";
import type { Config, LmClient, SavedSession, SessionState } from "../contracts/index.ts";
import type { Notify } from "../lmstudio/index.ts";
import { chooseResumeModel, FileSessionStore } from "../storage/index.ts";
import type { HarnessSeams } from "./open-harness.ts";
import { openSessionRuntime, type SessionRuntime } from "./session-runtime.ts";
import { createSessionState } from "./session-state.ts";
import { TranscriptSync } from "./transcript-sync.ts";

export interface ActiveSession {
  state: SessionState;
  runtime: SessionRuntime;
  /** Writes whatever the history gained or lost since the last save. */
  save(): Promise<void>;
  close(): Promise<void>;
}

export interface ActiveSessionContext {
  options: HarnessOptions;
  seams: HarnessSeams;
}

/** `--resume`: the most recent saved session. Read-only, so it runs before connecting. */
export async function findSessionToResume(root: string): Promise<SavedSession> {
  const saved = await new FileSessionStore(root).newest();
  if (!saved) {
    throw new Error(
      "There is no saved session to resume. Run clankr without --resume to start one.",
    );
  }
  return saved;
}

/**
 * The state a session starts with: a resumed session's history, or for `/clear` the previous
 * session's model, mode, reasoning setting, and output format with an empty history. A new
 * or resumed session starts with the `--format` flag's format, if one was given.
 */
export function initialSessionState(
  options: HarnessOptions,
  saved: SavedSession | undefined,
  carryOver?: SessionState,
): SessionState {
  return createSessionState({
    id: saved?.id ?? "",
    ephemeral: options.ephemeral,
    permissionMode: carryOver?.permissionMode ?? options.config.permissions.mode,
    ...(carryOver?.model ? { model: carryOver.model } : {}),
    ...(carryOver ? { reasoning: carryOver.reasoning } : {}),
    outputFormat: carryOver ? carryOver.outputFormat : options.outputFormat,
    ...(saved ? { messages: saved.messages } : {}),
    ...(saved?.activatedToolGroups ? { activatedToolGroups: saved.activatedToolGroups } : {}),
  });
}

/** Opens storage and the rest of the session's runtime around a state. */
export async function openActiveSession(
  { options, seams }: ActiveSessionContext,
  state: SessionState,
  saved?: SavedSession,
): Promise<ActiveSession> {
  const runtime = await openSessionRuntime({
    root: seams.root,
    ephemeral: options.ephemeral,
    ...(saved ? { resumeSessionId: saved.id } : {}),
    config: options.config,
    lm: seams.connection.lm,
    workingDirectory: options.workingDirectory,
    session: state,
    ...(state.model ? { model: state.model } : {}),
    approvalPrompter: options.approvalPrompter,
    allowData: options.allowData === true,
    fileTools: seams.fileTools,
    ...(seams.homeDirectory ? { homeDirectory: seams.homeDirectory } : {}),
  });
  state.id = runtime.paths.session.id;
  const sync = new TranscriptSync(runtime.transcript, {
    messages: state.messages,
    ...(saved?.activatedToolGroups ? { toolGroups: saved.activatedToolGroups } : {}),
    ...(saved?.modelKey ? { modelKey: saved.modelKey } : {}),
  });
  return {
    state,
    runtime,
    save: () => sync.sync(state),
    async close() {
      try {
        await sync.sync(state);
      } finally {
        await runtime.close();
      }
    },
  };
}

/**
 * The configured default, or for a resumed session the model it last used when LM Studio
 * still has it (specs/storage.md). A failed listing is left for the connection to report.
 */
export async function chooseStartingModel(
  lm: LmClient,
  config: Config,
  savedModelKey: string | undefined,
  notify: Notify,
): Promise<string> {
  if (!savedModelKey) return config.model.default;
  let available: string[];
  try {
    available = (await lm.listModels())
      .filter((model) => model.type === "llm")
      .map((model) => model.key);
  } catch {
    return savedModelKey;
  }
  const choice = chooseResumeModel(savedModelKey, available, config.model.default);
  if (choice.notice) notify(choice.notice);
  return choice.modelKey;
}
