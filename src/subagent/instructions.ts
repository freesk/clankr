// The words a sub-agent is given: its standing rules, and the two follow-up requests used
// when it runs out of turns or writes a summary over the cap. Kept short: every token here
// is paid on each of the sub-agent's requests.

/** A rough words-per-token ratio, only to give the model a length it can picture. */
const wordsPerToken = 0.75;

function wordsFor(tokens: number): number {
  return Math.max(1, Math.floor(tokens * wordsPerToken));
}

export function subAgentInstructions(summaryTokenCap: number): string {
  return [
    "You are a sub-agent doing one task for the main assistant. You cannot ask it or the user anything.",
    "- Use the read-only tools to do the task. You cannot change files.",
    `- Finish with a summary of what you found, at most ${summaryTokenCap} tokens (about ${wordsFor(summaryTokenCap)} words).`,
    "- Give facts, paths, and numbers. Name result handles such as r12 for details that do not fit.",
  ].join("\n");
}

export function turnLimitSummaryRequest(summaryTokenCap: number): string {
  return (
    "You have used all your tool turns. Do not call any tool. " +
    `Reply now with your summary of what you found so far, at most ${summaryTokenCap} tokens.`
  );
}

export function missingSummaryRequest(summaryTokenCap: number): string {
  return `Do not call any tool. Reply with your summary of what you found, at most ${summaryTokenCap} tokens.`;
}

export function shortenSummaryRequest(summaryTokens: number, summaryTokenCap: number): string {
  return (
    `That summary is about ${summaryTokens} tokens; the limit is ${summaryTokenCap}. ` +
    "Do not call any tool. Rewrite it within the limit, keeping paths, numbers, and handles."
  );
}

export const noSummaryText = "The sub-agent stopped without writing a summary.";

export const turnLimitNote =
  "[The sub-agent reached its turn limit; this summary may be incomplete.]";
