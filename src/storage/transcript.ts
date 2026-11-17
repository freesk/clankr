// The transcript file format and its writers. One JSON object per line, appended as
// things happen, so a crash loses at most the line being written.

import { stat } from "node:fs/promises";
import type { ChatMessage, SessionTranscript } from "../contracts/index.ts";
import { appendPrivateFile, isMissingFileError } from "./private-files.ts";

/** Bumped if the record shapes change, so an old transcript can still be read. */
export const transcriptFormatVersion = 1;

export type TranscriptRecord =
  | { type: "session"; version: number; id: string; createdAt: string }
  | { type: "message"; at: string; message: ChatMessage }
  | { type: "model"; at: string; modelKey: string };

/**
 * Appends to `transcript.jsonl`. The file, and its header record, are created on the
 * first append, so a session that never says anything leaves no transcript behind.
 */
export class FileTranscript implements SessionTranscript {
  // Appends are chained so records land in call order even when callers do not await.
  private pending: Promise<void> = Promise.resolve();
  private headerWritten: boolean | undefined;
  private readonly transcriptPath: string;
  private readonly sessionId: string;

  constructor(transcriptPath: string, sessionId: string) {
    this.transcriptPath = transcriptPath;
    this.sessionId = sessionId;
  }

  appendMessage(message: ChatMessage): Promise<void> {
    return this.enqueue({ type: "message", at: nowIso(), message });
  }

  recordModel(modelKey: string): Promise<void> {
    return this.enqueue({ type: "model", at: nowIso(), modelKey });
  }

  private enqueue(record: TranscriptRecord): Promise<void> {
    const next = this.pending.then(() => this.write(record));
    // A failed write must not block every later one; the caller still sees this failure.
    this.pending = next.catch(() => undefined);
    return next;
  }

  private async write(record: TranscriptRecord): Promise<void> {
    if (!(await this.hasHeader())) {
      await this.appendLine({
        type: "session",
        version: transcriptFormatVersion,
        id: this.sessionId,
        createdAt: nowIso(),
      });
      this.headerWritten = true;
    }
    await this.appendLine(record);
  }

  // A resumed session already has a header; checking once avoids writing a second one.
  private async hasHeader(): Promise<boolean> {
    if (this.headerWritten === undefined) {
      this.headerWritten = await fileExists(this.transcriptPath);
    }
    return this.headerWritten;
  }

  private appendLine(record: TranscriptRecord): Promise<void> {
    return appendPrivateFile(this.transcriptPath, `${JSON.stringify(record)}\n`);
  }
}

/** The ephemeral transcript: accepts everything, writes nothing. */
export class DiscardingTranscript implements SessionTranscript {
  async appendMessage(): Promise<void> {}
  async recordModel(): Promise<void> {}
}

/** Parses transcript text. Lines that do not parse are skipped: a crash can cut the last one. */
export function parseTranscript(text: string): TranscriptRecord[] {
  const records: TranscriptRecord[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const record = parseRecord(line);
    if (record) records.push(record);
  }
  return records;
}

function parseRecord(line: string): TranscriptRecord | undefined {
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value === "object" && value !== null && "type" in value) {
      return value as TranscriptRecord;
    }
  } catch {
    // Fall through: an unreadable line is dropped, not fatal.
  }
  return undefined;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}
