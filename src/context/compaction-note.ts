// The structured note that replaces summarized turns (PRD section 7.2, technique 6):
// goal, facts found, files touched, open steps. The model writes goal, facts, and open steps;
// files touched and stored results are also collected mechanically, because a detail a small
// model drops from a summary is lost for good (PRD section 12, compaction risk).

import type { ChatMessage, ResultMeta } from "../contracts/index.ts";
import { messageText, toolCallsById, truncateEnd } from "./message-text.ts";

export const summaryMarker = "[Summary of earlier conversation]";

export interface SummaryFields {
  goal: string[];
  facts: string[];
  files: string[];
  openSteps: string[];
}

const headings: { field: keyof SummaryFields; pattern: RegExp }[] = [
  { field: "goal", pattern: /^goal\s*(:|$)/i },
  { field: "facts", pattern: /^facts?( found)?\s*(:|$)/i },
  { field: "files", pattern: /^files?( touched)?\s*(:|$)/i },
  { field: "openSteps", pattern: /^(open|next) steps?\s*(:|$)/i },
];

const pathArgumentPattern = /path|file|source|destination|target|folder|directory/i;
const labelCharacters = 60;

export function emptyFields(): SummaryFields {
  return { goal: [], facts: [], files: [], openSteps: [] };
}

/** One line per message, in a form a model can summarize. */
export function renderTranscript(messages: ChatMessage[], maximumPerMessage: number): string {
  const calls = toolCallsById(messages);
  return messages
    .map((message) => {
      const text = truncateEnd(messageText(message), maximumPerMessage);
      return transcriptLine(message, text, calls);
    })
    .join("\n");
}

function transcriptLine(
  message: ChatMessage,
  text: string,
  calls: ReturnType<typeof toolCallsById>,
): string {
  if (message.role === "system") return `System: ${text}`;
  if (message.role === "user") return `User: ${text}`;
  if (message.role === "tool") {
    return `Result of ${calls.get(message.toolCallId)?.name ?? "tool"}: ${text}`;
  }
  const called = (message.toolCalls ?? []).map((call) => `${call.name} ${call.argumentsJson}`);
  const calledText = called.length > 0 ? ` [called ${called.join("; ")}]` : "";
  return `Assistant: ${text}${calledText}`;
}

/** Reads the four headings from a model's reply. Text before any heading counts as facts. */
export function parseSummary(reply: string): SummaryFields {
  const fields = emptyFields();
  let current: keyof SummaryFields = "facts";
  for (const rawLine of reply.split("\n")) {
    // Strip Markdown heading, bullet, and bold marks; underscores stay, file names use them.
    const line = rawLine
      .trim()
      .replace(/^#+\s*/, "")
      .replace(/^[-•*]\s+/, "")
      .replace(/\*\*/g, "")
      .trim();
    if (line.length === 0) continue;
    const heading = headings.find((candidate) => candidate.pattern.test(line));
    if (heading) {
      current = heading.field;
      const rest = line.replace(/^[^:]*:?/, "").trim();
      if (rest.length > 0) fields[current].push(rest);
      continue;
    }
    fields[current].push(line);
  }
  return fields;
}

/** Paths named in tool call arguments: the files the session has touched. */
export function filesTouchedBy(messages: ChatMessage[]): string[] {
  const paths = new Set<string>();
  for (const call of toolCallsById(messages).values()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(call.argumentsJson);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    for (const [key, value] of Object.entries(parsed)) {
      if (pathArgumentPattern.test(key) && typeof value === "string" && value.length > 0) {
        paths.add(value);
      }
    }
  }
  return [...paths];
}

export function mergeFiles(fields: SummaryFields, mechanicalFiles: string[]): SummaryFields {
  const files = [...new Set([...fields.files, ...mechanicalFiles])];
  return { ...fields, files };
}

export function formatNote(fields: SummaryFields, storedResults: ResultMeta[]): string {
  const sections = [summaryMarker];
  sections.push(`Goal: ${fields.goal.join(" ") || "(not recorded)"}`);
  sections.push(bulletSection("Facts found", fields.facts));
  sections.push(bulletSection("Files touched", fields.files));
  if (storedResults.length > 0) {
    const listed = storedResults.map((meta) => `${meta.handle} ${resultLabel(meta)}`);
    sections.push(`Stored results (read_result): ${listed.join("; ")}`);
  }
  sections.push(bulletSection("Open steps", fields.openSteps));
  return sections.join("\n");
}

function bulletSection(title: string, items: string[]): string {
  if (items.length === 0) return `${title}: none`;
  return [`${title}:`, ...items.map((item) => `- ${item.replace(/^[-•]\s*/, "")}`)].join("\n");
}

function resultLabel(meta: ResultMeta): string {
  return truncateEnd(meta.label ?? meta.tool, labelCharacters);
}
