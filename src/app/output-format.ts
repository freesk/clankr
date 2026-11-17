// What a tool run is told about the output format (D85): the session's setting, the formats
// the user's own message names (D86), and, in the REPL, a way to ask. A pick the user keeps
// becomes the session's format, exactly as `/format` would set it.

import { lastUserText } from "../agent/index.ts";
import type {
  OutputFormatContext,
  OutputFormatPrompter,
  SessionState,
} from "../contracts/index.ts";
import { formatsNamedIn } from "../output/index.ts";

export function outputFormatContextFor(
  state: SessionState,
  prompter: OutputFormatPrompter | undefined,
  signal: AbortSignal,
): OutputFormatContext {
  const context: OutputFormatContext = {
    namedByUser: formatsNamedIn(lastUserText(state.messages)),
  };
  if (state.outputFormat) context.sessionFormat = state.outputFormat;
  if (prompter) {
    context.ask = async (question) => {
      const answer = await prompter.ask(question, signal);
      if (answer?.keepForSession) state.outputFormat = answer.format;
      return answer?.format;
    };
  }
  return context;
}
