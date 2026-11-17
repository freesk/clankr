// `/format` and the two-step format question, driven through the same picker contract the
// REPL lends (`SlashCommandContext.choose`).

import { describe, expect, it } from "vitest";
import { createSessionState } from "../app/session-state.ts";
import { defaultConfig } from "../config/index.ts";
import type { OutputFormat, SlashCommandContext } from "../contracts/index.ts";
import { ScriptedLmClient } from "../testing/index.ts";
import { formatCommand } from "./format-command.ts";
import { createPickerFormatPrompter } from "./format-picker.ts";

interface PickerCall {
  prompt: string;
  labels: string[];
}

/** A picker that answers from a queue and records what it showed. */
function scriptedPicker(answers: (string | undefined)[]) {
  const calls: PickerCall[] = [];
  const choose: NonNullable<SlashCommandContext["choose"]> = async (prompt, options) => {
    calls.push({ prompt, labels: options.map((option) => option.label) });
    return answers.shift();
  };
  return { calls, choose };
}

function commandContext(options: { answers?: (string | undefined)[]; configured?: OutputFormat }) {
  const printed: string[] = [];
  const config = defaultConfig();
  if (options.configured) config.output.defaultFormat = options.configured;
  const picker = options.answers ? scriptedPicker(options.answers) : undefined;
  const context: SlashCommandContext = {
    session: createSessionState({ id: "s1", ephemeral: true, permissionMode: "ask" }),
    config,
    lm: new ScriptedLmClient(),
    print: (text) => printed.push(text),
    ...(picker ? { choose: picker.choose } : {}),
  };
  return { context, printed, picker };
}

describe("/format", () => {
  it("sets the session format from its argument, whatever its case", async () => {
    const { context, printed } = commandContext({});
    await formatCommand.run(" DOCX ", context);
    expect(context.session.outputFormat).toBe("docx");
    expect(printed.at(-1)).toContain("saved as docx in this session");
    expect(printed.at(-1)).toContain("A format named in a request still wins");
  });

  it("clears the session format with `ask`", async () => {
    const { context, printed } = commandContext({});
    await formatCommand.run("pdf", context);
    await formatCommand.run("ask", context);
    expect(context.session.outputFormat).toBeUndefined();
    expect(printed.at(-1)).toContain("clankr asks when it saves a chart or table");
  });

  it("refuses an unknown format and changes nothing", async () => {
    const { context, printed } = commandContext({});
    await formatCommand.run("pptx", context);
    expect(context.session.outputFormat).toBeUndefined();
    expect(printed.at(-1)).toMatch(
      /Unknown format "pptx"\. Use one of xlsx, docx, pdf, png, svg, csv/,
    );
  });

  it("shows the setting and opens the picker when given no argument", async () => {
    const { context, printed, picker } = commandContext({ answers: ["xlsx"], configured: "pdf" });
    await formatCommand.run("", context);
    expect(printed[0]).toContain("the config default is pdf");
    expect(picker?.calls[0]?.labels).toEqual([
      "xlsx  Excel workbook",
      "docx  Word document",
      "pdf  PDF document",
      "png  PNG image",
      "svg  SVG image",
      "csv  CSV text file",
      "ask  Ask each time",
    ]);
    expect(context.session.outputFormat).toBe("xlsx");
  });

  it("keeps the setting when the picker is closed, and only prints outside the REPL", async () => {
    const closed = commandContext({ answers: [undefined] });
    await formatCommand.run("svg", closed.context);
    await formatCommand.run("", closed.context);
    expect(closed.context.session.outputFormat).toBe("svg");

    const noPicker = commandContext({});
    await formatCommand.run("", noPicker.context);
    expect(noPicker.printed).toHaveLength(1);
  });
});

describe("the format question (step 4 of D85)", () => {
  const question = { what: "chart", formats: ["pdf", "docx", "xlsx"] as const };

  it("asks for the format, then whether to keep it", async () => {
    const { calls, choose } = scriptedPicker(["docx", "once"]);
    const answer = await createPickerFormatPrompter(choose).ask(question);
    expect(answer).toEqual({ format: "docx", keepForSession: false });
    expect(calls[0]).toEqual({
      prompt: "Save the chart as which format?",
      labels: ["pdf  PDF document", "docx  Word document", "xlsx  Excel workbook"],
    });
    expect(calls[1]?.prompt).toBe("Use docx for");
    expect(calls[1]?.labels[0]).toBe("This chart only");
  });

  it("keeps the pick for the session when the user says so", async () => {
    const { choose } = scriptedPicker(["xlsx", "session"]);
    expect(await createPickerFormatPrompter(choose).ask(question)).toEqual({
      format: "xlsx",
      keepForSession: true,
    });
  });

  it("is cancelled by closing either question", async () => {
    expect(
      await createPickerFormatPrompter(scriptedPicker([undefined]).choose).ask(question),
    ).toBeUndefined();
    expect(
      await createPickerFormatPrompter(scriptedPicker(["pdf", undefined]).choose).ask(question),
    ).toBeUndefined();
  });

  it("never returns a format that was not offered", async () => {
    const { choose } = scriptedPicker(["png", "once"]);
    expect(await createPickerFormatPrompter(choose).ask(question)).toBeUndefined();
  });
});
