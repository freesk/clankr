// Reading saved sessions back: listing them and loading one for `--resume` (CLI-9, D32).

import { readdir, readFile, stat } from "node:fs/promises";
import type {
  ChatMessage,
  SavedSession,
  SessionStore,
  SessionSummary,
  ToolGroup,
} from "../contracts/index.ts";
import { buildClankrPaths, buildRootPaths, isValidSessionId } from "./layout.ts";
import { isMissingFileError } from "./private-files.ts";
import { parseTranscript } from "./transcript.ts";

interface TranscriptOnDisk {
  sessionId: string;
  lastActivity: Date;
}

export class FileSessionStore implements SessionStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async list(): Promise<SessionSummary[]> {
    const summaries: SessionSummary[] = [];
    for (const transcript of await this.transcriptsNewestFirst()) {
      const session = await this.load(transcript.sessionId);
      if (session.messages.length === 0) continue;
      summaries.push({
        id: session.id,
        createdAt: session.createdAt,
        lastActivityAt: transcript.lastActivity.toISOString(),
        messageCount: session.messages.length,
      });
    }
    return summaries;
  }

  async load(sessionId: string): Promise<SavedSession> {
    if (!isValidSessionId(sessionId)) throw new Error(`No saved session "${sessionId}".`);
    const transcriptPath = buildClankrPaths(this.root, sessionId).session.transcript;
    let text: string;
    try {
      text = await readFile(transcriptPath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) throw new Error(`No saved session "${sessionId}".`);
      throw error;
    }
    return sessionFromTranscript(sessionId, text);
  }

  async newest(): Promise<SavedSession | undefined> {
    for (const transcript of await this.transcriptsNewestFirst()) {
      const session = await this.load(transcript.sessionId);
      if (session.messages.length > 0) return session;
    }
    return undefined;
  }

  // Ordered by when the transcript was last written, so the session the user was
  // most recently talking in comes first, even if it was started long ago.
  private async transcriptsNewestFirst(): Promise<TranscriptOnDisk[]> {
    const found: TranscriptOnDisk[] = [];
    for (const sessionId of await this.sessionIds()) {
      const transcriptPath = buildClankrPaths(this.root, sessionId).session.transcript;
      const lastActivity = await modifiedTime(transcriptPath);
      if (lastActivity) found.push({ sessionId, lastActivity });
    }
    return found.sort(
      (left, right) =>
        right.lastActivity.getTime() - left.lastActivity.getTime() ||
        right.sessionId.localeCompare(left.sessionId),
    );
  }

  private async sessionIds(): Promise<string[]> {
    try {
      const entries = await readdir(buildRootPaths(this.root).sessionsDirectory, {
        withFileTypes: true,
      });
      return entries
        .filter((entry) => entry.isDirectory() && isValidSessionId(entry.name))
        .map((entry) => entry.name);
    } catch (error) {
      if (isMissingFileError(error)) return [];
      throw error;
    }
  }
}

function sessionFromTranscript(sessionId: string, text: string): SavedSession {
  const messages: ChatMessage[] = [];
  let createdAt: string | undefined;
  let modelKey: string | undefined;
  let activatedToolGroups: ToolGroup[] | undefined;
  for (const record of parseTranscript(text)) {
    if (record.type === "session") createdAt ??= record.createdAt;
    else if (record.type === "message") messages.push(record.message);
    else if (record.type === "model") modelKey = record.modelKey;
    else if (record.type === "history") messages.splice(0, messages.length, ...record.messages);
    else if (record.type === "tool-groups") activatedToolGroups = record.groups;
  }
  const session: SavedSession = { id: sessionId, createdAt, messages, modelKey };
  if (activatedToolGroups) session.activatedToolGroups = activatedToolGroups;
  return session;
}

async function modifiedTime(path: string): Promise<Date | undefined> {
  try {
    return (await stat(path)).mtime;
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
}

/**
 * Which model a resumed session loads. The saved one when LM Studio still has it,
 * otherwise the configured default with a notice for the user (specs/storage.md).
 */
export function chooseResumeModel(
  savedModelKey: string | undefined,
  availableModelKeys: string[],
  defaultModelKey: string,
): { modelKey: string; notice?: string } {
  if (!savedModelKey || availableModelKeys.includes(savedModelKey)) {
    return { modelKey: savedModelKey ?? defaultModelKey };
  }
  return {
    modelKey: defaultModelKey,
    notice: `The session's model "${savedModelKey}" is no longer available; using "${defaultModelKey}".`,
  };
}
