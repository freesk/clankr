// `/format` (CLI-3, D85): show or set the format charts and tables are saved in for this
// session. `--format` sets the same value at start. A format named in a request still wins.

import {
  isOutputFormat,
  outputFormats,
  type SlashCommand,
  type SlashCommandContext,
} from "../contracts/index.ts";
import { formatOption } from "./format-picker.ts";
import { formatList } from "./formats.ts";

/** Clears the session format, so the config default applies or clankr asks again. */
const askWord = "ask";

export const formatCommand: SlashCommand = {
  name: "format",
  summary: "Show or set the format charts and tables are saved in",
  usage: `/format [${outputFormats.join("|")}|${askWord}]`,
  async run(argumentText, context) {
    const word = argumentText.trim().toLowerCase();
    if (word === "") {
      await showAndPick(context);
    } else if (word === askWord || isOutputFormat(word)) {
      setFormat(word, context);
    } else {
      context.print(
        `Unknown format "${word}". Use one of ${formatList(outputFormats)}, or "${askWord}" to be asked each time.`,
      );
    }
  },
};

async function showAndPick(context: SlashCommandContext): Promise<void> {
  context.print(describeSetting(context));
  if (!context.choose) return;
  const picked = await context.choose("Save charts and tables as", [
    ...outputFormats.map(formatOption),
    { label: `${askWord}  Ask each time`, value: askWord },
  ]);
  if (picked === askWord || (picked && isOutputFormat(picked))) setFormat(picked, context);
}

function setFormat(word: string, context: SlashCommandContext): void {
  if (isOutputFormat(word)) context.session.outputFormat = word;
  else delete context.session.outputFormat;
  context.print(describeSetting(context));
}

function describeSetting(context: SlashCommandContext): string {
  const sessionFormat = context.session.outputFormat;
  if (sessionFormat) {
    return `Charts and tables are saved as ${sessionFormat} in this session. A format named in a request still wins.`;
  }
  const configured = context.config.output.defaultFormat;
  if (configured) {
    return `No format is set for this session; the config default is ${configured}. A format named in a request still wins.`;
  }
  return "No format is set: clankr asks when it saves a chart or table, unless the request names a format.";
}
