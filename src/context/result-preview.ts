// Capping a tool result (CTX-2). Under the cap, the output passes through. Over it, the full
// text goes to the result store and the model gets a head-and-tail preview plus the handle.

import type {
  CappedResult,
  ResultHandle,
  ResultProvenance,
  ResultStore,
  ToolOutput,
} from "../contracts/index.ts";
import type { TokenLedger } from "./token-ledger.ts";

/** The start of a result usually says what it is; the end often holds totals. Favour the start. */
const headShare = 2 / 3;
const fittingAttempts = 6;

export async function capToolOutput(
  output: ToolOutput,
  tokenCap: number,
  provenance: ResultProvenance,
  ledger: TokenLedger,
  results: ResultStore,
): Promise<CappedResult> {
  const tokens = await ledger.countText(output.text);
  if (tokens <= tokenCap) return { text: output.text, tokens };

  const handle = await results.putText(output.text, provenance);
  const lines = output.text.split("\n");
  const header = previewHeader(handle, lines.length, tokens);
  const charactersPerToken = output.text.length / Math.max(tokens, 1);
  let characterBudget = Math.floor(tokenCap * charactersPerToken);

  // The character estimate can be off for unusual text, so measure and shrink until it fits.
  for (let attempt = 0; attempt < fittingAttempts && characterBudget > 0; attempt++) {
    const text = buildPreview(header, lines, handle, characterBudget);
    const previewTokens = await ledger.countText(text);
    if (previewTokens <= tokenCap) return { text, tokens: previewTokens, handle };
    characterBudget = Math.floor(characterBudget * (tokenCap / previewTokens) * 0.9);
  }
  return { text: header, tokens: await ledger.countText(header), handle };
}

function previewHeader(handle: ResultHandle, lineCount: number, tokens: number): string {
  return (
    `[Output too long (${lineCount} lines, about ${tokens} tokens), stored as ${handle}. ` +
    `Showing the start and end. Use read_result with handle ${handle} to page or search it.]`
  );
}

function buildPreview(
  header: string,
  lines: string[],
  handle: ResultHandle,
  characterBudget: number,
): string {
  const bodyBudget = characterBudget - header.length;
  if (bodyBudget <= 0) return header;
  const head = takeHead(lines, Math.floor(bodyBudget * headShare));
  const tail = takeTail(lines, bodyBudget - head.characters, head.endIndex);
  const omittedLines = tail.startIndex - head.endIndex;
  const omission = `[… ${omittedLines} lines omitted, see ${handle} …]`;
  return [header, ...head.lines, omission, ...tail.lines].join("\n");
}

interface TakenLines {
  lines: string[];
  characters: number;
}

/** Whole lines from the start; a first line longer than the budget is cut. */
function takeHead(lines: string[], budget: number): TakenLines & { endIndex: number } {
  const taken: string[] = [];
  let characters = 0;
  for (const line of lines) {
    if (characters + line.length + 1 > budget) {
      if (taken.length === 0 && budget > 1) {
        taken.push(`${line.slice(0, budget - 1)}…`);
        characters = budget;
      }
      break;
    }
    taken.push(line);
    characters += line.length + 1;
  }
  // A cut first line counts as shown, so the omission count stays about whole lines.
  return { lines: taken, characters, endIndex: taken.length };
}

/** Whole lines from the end, never reaching back past `notBefore`. */
function takeTail(
  lines: string[],
  budget: number,
  notBefore: number,
): TakenLines & { startIndex: number } {
  const taken: string[] = [];
  let characters = 0;
  let startIndex = lines.length;
  while (startIndex - 1 >= notBefore) {
    const line = lines[startIndex - 1] ?? "";
    if (characters + line.length + 1 > budget) break;
    taken.unshift(line);
    characters += line.length + 1;
    startIndex -= 1;
  }
  return { lines: taken, characters, startIndex };
}
