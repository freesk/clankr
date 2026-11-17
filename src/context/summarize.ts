// The summary call: asks the model to compress older turns into the structured note.
// The request itself must fit the window, so the transcript is shortened until it does.

import type { ChatMessage, LmClient, ResultMeta, ResultStore } from "../contracts/index.ts";
import {
  emptyFields,
  filesTouchedBy,
  formatNote,
  mergeFiles,
  parseSummary,
  renderTranscript,
  type SummaryFields,
} from "./compaction-note.ts";
import { storedHandlesIn } from "./eviction.ts";
import { messageText, truncateEnd, truncateMiddle } from "./message-text.ts";
import type { TokenLedger } from "./token-ledger.ts";

const summaryInstructions = [
  "You compress the older part of a conversation between a user and an assistant that uses tools on the user's files.",
  "Write a note the assistant can continue from without the old messages.",
  "Use exactly these four headings, each followed by short bullet lines:",
  "Goal:",
  "Facts found:",
  "Files touched:",
  "Open steps:",
  "Keep exact file paths, numbers, names, and result handles such as r12. Do not invent anything. Do not answer the user.",
].join("\n");

/** Per-message character limits tried in turn until the transcript fits; the last is a hard cut. */
const transcriptLimits = [Number.POSITIVE_INFINITY, 4_000, 1_500, 600, 200];
const goalFallbackCharacters = 300;

export interface SummarizeOptions {
  lm: LmClient;
  modelKey: string;
  ledger: TokenLedger;
  results: ResultStore;
  contextLength: number;
  /** The most tokens the note may take. */
  summaryTokens: number;
}

/** Summarizes `messages` into one note. Falls back to a mechanical note if the call fails. */
export async function summarizeMessages(
  messages: ChatMessage[],
  options: SummarizeOptions,
): Promise<string> {
  const reply = await requestSummary(messages, options);
  const modelFields = reply ? parseSummary(reply) : fallbackFields(messages);
  const fields = mergeFiles(modelFields, filesTouchedBy(messages));
  const stored = await storedResultsIn(messages, options.results);
  return fitNote(fields, stored, options);
}

async function requestSummary(
  messages: ChatMessage[],
  options: SummarizeOptions,
): Promise<string | undefined> {
  const transcript = await fittedTranscript(messages, options);
  const request: ChatMessage[] = [
    { role: "system", content: summaryInstructions },
    { role: "user", content: `Conversation to summarize:\n\n${transcript}` },
  ];
  try {
    let reply = "";
    const chat = options.lm.chat(
      // Reasoning is off: it would spend the window on text that is thrown away.
      {
        model: options.modelKey,
        messages: request,
        reasoning: "off",
        maxTokens: options.summaryTokens,
      },
      new AbortController().signal,
    );
    for await (const event of chat) if (event.type === "text") reply += event.delta;
    return reply.trim().length > 0 ? reply : undefined;
  } catch {
    // A failed summary must not fail the turn; the mechanical note still keeps handles and files.
    return undefined;
  }
}

async function fittedTranscript(
  messages: ChatMessage[],
  options: SummarizeOptions,
): Promise<string> {
  const instructionTokens = await options.ledger.countText(summaryInstructions);
  const budget = options.contextLength - options.summaryTokens - instructionTokens;
  let transcript = "";
  for (const limit of transcriptLimits) {
    transcript = renderTranscript(messages, limit);
    const tokens = await options.ledger.countText(transcript);
    if (tokens <= budget) return transcript;
  }
  // Still too long: keep the start (the goal) and the end (the latest state).
  const charactersPerToken =
    transcript.length / Math.max(await options.ledger.countText(transcript), 1);
  return truncateMiddle(transcript, Math.floor(budget * charactersPerToken * 0.9));
}

function fallbackFields(messages: ChatMessage[]): SummaryFields {
  const fields = emptyFields();
  const userMessages = messages.filter((message) => message.role === "user");
  const first = userMessages[0];
  const last = userMessages.at(-1);
  if (first) fields.goal.push(truncateEnd(messageText(first), goalFallbackCharacters));
  if (last && last !== first) {
    fields.openSteps.push(
      `Latest request: ${truncateEnd(messageText(last), goalFallbackCharacters)}`,
    );
  }
  return fields;
}

async function storedResultsIn(
  messages: ChatMessage[],
  results: ResultStore,
): Promise<ResultMeta[]> {
  const allText = messages.map(messageText).join("\n");
  const handles = await storedHandlesIn(allText, results);
  return Promise.all(handles.map((handle) => results.describe(handle)));
}

/** Shrinks the longest free-text field until the note fits its share of the window. */
async function fitNote(
  fields: SummaryFields,
  stored: ResultMeta[],
  options: SummarizeOptions,
): Promise<string> {
  let current = fields;
  let note = formatNote(current, stored);
  while ((await options.ledger.countText(note)) > options.summaryTokens) {
    const shrunk = dropOneLine(current);
    if (!shrunk) break;
    current = shrunk;
    note = formatNote(current, stored);
  }
  return note;
}

/** Removes the last line of the longest list, or undefined when only the goal is left. */
function dropOneLine(fields: SummaryFields): SummaryFields | undefined {
  const lists = ["facts", "files", "openSteps"] as const;
  const longest = [...lists].sort((a, b) => fields[b].length - fields[a].length)[0];
  if (!longest || fields[longest].length === 0) return undefined;
  return { ...fields, [longest]: fields[longest].slice(0, -1) };
}
