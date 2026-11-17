// Keeps the saved transcript in step with the session's history (CLI-9). The agent loop
// mostly appends, but compaction and `/compact` replace the history (D51), so each sync
// compares the history with what was last written: an extension appends the new messages,
// anything else writes one "history" record that a resume reads in place of the old lines.
// Nothing is written until the session has a message, so a session where nothing was said
// leaves no transcript and storage removes its directory on close.

import type {
  ChatMessage,
  SessionState,
  SessionTranscript,
  ToolGroup,
} from "../contracts/index.ts";

export interface SavedTranscriptState {
  messages?: readonly ChatMessage[];
  toolGroups?: readonly ToolGroup[];
  modelKey?: string;
}

export class TranscriptSync {
  private readonly transcript: SessionTranscript;
  private written: ChatMessage[];
  private writtenGroups: string;
  private writtenModelKey: string | undefined;
  // Syncs are chained so two callers never interleave their writes.
  private pending: Promise<void> = Promise.resolve();

  /** `saved` is what the transcript holds now: nothing for a new session, or the resumed state. */
  constructor(transcript: SessionTranscript, saved: SavedTranscriptState = {}) {
    this.transcript = transcript;
    this.written = [...(saved.messages ?? [])];
    this.writtenGroups = groupsKey(saved.toolGroups ?? []);
    this.writtenModelKey = saved.modelKey;
  }

  sync(session: SessionState): Promise<void> {
    const next = this.pending.then(() => this.write(session));
    this.pending = next.catch(() => undefined);
    return next;
  }

  private async write(session: SessionState): Promise<void> {
    const messages = [...session.messages];
    if (messages.length === 0 && this.written.length === 0) return;
    const modelKey = session.model?.key;
    if (modelKey && modelKey !== this.writtenModelKey) {
      await this.transcript.recordModel(modelKey);
      this.writtenModelKey = modelKey;
    }
    if (startsWithMessages(messages, this.written)) {
      for (const message of messages.slice(this.written.length)) {
        await this.transcript.appendMessage(message);
      }
    } else {
      await this.transcript.replaceHistory(messages);
    }
    this.written = messages;
    const groups = session.activatedToolGroups ?? [];
    if (groupsKey(groups) !== this.writtenGroups) {
      await this.transcript.recordToolGroups([...groups]);
      this.writtenGroups = groupsKey(groups);
    }
  }
}

// Messages are compared by identity: the loop keeps the same objects when it only appends,
// and compaction builds new ones for anything it changes.
function startsWithMessages(
  messages: readonly ChatMessage[],
  prefix: readonly ChatMessage[],
): boolean {
  if (messages.length < prefix.length) return false;
  return prefix.every((message, index) => messages[index] === message);
}

function groupsKey(groups: readonly ToolGroup[]): string {
  return [...groups].sort().join(",");
}
