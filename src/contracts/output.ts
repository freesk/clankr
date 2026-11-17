// Output formats and how one is chosen (seams: output → the data tools; cli → output for the
// format question). The list is defined here, once, with the check that a word is on it.

/** Every format clankr can write a chart or a table in. */
export const outputFormats = ["xlsx", "docx", "pdf", "png", "svg", "csv"] as const;

export type OutputFormat = (typeof outputFormats)[number];

export function isOutputFormat(text: string): text is OutputFormat {
  return (outputFormats as readonly string[]).includes(text);
}

/** What each format is, as the user would call it. Shown in the picker and in `/format`. */
export const outputFormatLabels: Record<OutputFormat, string> = {
  xlsx: "Excel workbook",
  docx: "Word document",
  pdf: "PDF document",
  png: "PNG image",
  svg: "SVG image",
  csv: "CSV text file",
};

export interface OutputFormatQuestion {
  /** What is about to be saved, for the prompt: "chart" or "table". */
  what: string;
  /** The formats that can hold it, in the order to offer them. */
  formats: readonly OutputFormat[];
}

export interface OutputFormatAnswer {
  format: OutputFormat;
  /** Use the format for the rest of the session, as `/format` would. */
  keepForSession: boolean;
}

/** Asks the user which format to save in. Resolves to undefined when they cancel. */
export interface OutputFormatPrompter {
  ask(
    question: OutputFormatQuestion,
    signal?: AbortSignal,
  ): Promise<OutputFormatAnswer | undefined>;
}

/**
 * What a tool knows about the output format beyond its own arguments. Absent from a
 * ToolContext where only the arguments and the config apply (tests, sub-agents).
 */
export interface OutputFormatContext {
  /** The session's format: `--format`, `/format`, or a pick the user kept for the session. */
  sessionFormat?: OutputFormat;
  /**
   * Formats the user's latest message names. A `format` argument or path extension that is
   * not among them is the model's guess, so it does not skip the question. Undefined means
   * unknown, and the arguments are trusted.
   */
  namedByUser?: readonly OutputFormat[];
  /**
   * Asks the user and resolves to their pick, or undefined when they cancel. A pick kept for
   * the session is stored by the harness. Absent where nobody can be asked (one-shot, D14).
   */
  ask?(question: OutputFormatQuestion): Promise<OutputFormat | undefined>;
}
