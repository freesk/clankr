// The format question as the REPL asks it (D85, step 4): which format, then whether to keep
// it. Both use the picker `/model` uses. The cli only lends the picker; the question is here.

import {
  type OutputFormat,
  type OutputFormatPrompter,
  outputFormatLabels,
  type SlashCommandContext,
} from "../contracts/index.ts";

export type Picker = NonNullable<SlashCommandContext["choose"]>;

const keepForSession = "session";
const thisFileOnly = "once";

/** One picker row: "docx  Word document". */
export function formatOption(format: OutputFormat): { label: string; value: string } {
  return { label: `${format}  ${outputFormatLabels[format]}`, value: format };
}

/** Closing either question cancels: nothing is saved in a format the user did not pick. */
export function createPickerFormatPrompter(choose: Picker): OutputFormatPrompter {
  return {
    async ask(question) {
      const picked = await choose(
        `Save the ${question.what} as which format?`,
        question.formats.map(formatOption),
      );
      const format = question.formats.find((candidate) => candidate === picked);
      if (!format) return undefined;
      const scope = await choose(`Use ${format} for`, [
        { label: `This ${question.what} only`, value: thisFileOnly },
        { label: "Every file in this session (change it with /format)", value: keepForSession },
      ]);
      if (!scope) return undefined;
      return { format, keepForSession: scope === keepForSession };
    },
  };
}
