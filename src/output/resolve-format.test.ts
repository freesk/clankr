// Every branch of the format order (D85): request, session, config, the question, and the
// error where nobody can be asked. Plus D86: a format the user's message does not name.

import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.ts";
import {
  type OutputFormat,
  type OutputFormatContext,
  type OutputFormatQuestion,
  ToolError,
} from "../contracts/index.ts";
import { chartOutputFormats, tableOutputFormats } from "./formats.ts";
import { type FormatRequest, resolveOutputFormat, settledOutputFormat } from "./resolve-format.ts";

function chartRequest(extra: Partial<FormatRequest> = {}): FormatRequest {
  return {
    what: "chart",
    allowed: chartOutputFormats,
    unsupported: (format) => `${format} cannot hold a chart; use export_table.`,
    ...extra,
  };
}

function contextWith(outputFormat: OutputFormatContext | undefined, defaultFormat?: OutputFormat) {
  const config = defaultConfig();
  if (defaultFormat) config.output.defaultFormat = defaultFormat;
  return { config, outputFormat };
}

/** A context whose question records what it was asked and answers with `answer`. */
function asking(answer: OutputFormat | undefined, extra: OutputFormatContext = {}) {
  const questions: OutputFormatQuestion[] = [];
  const context = contextWith({
    ...extra,
    ask: async (question) => {
      questions.push(question);
      return answer;
    },
  });
  return { context, questions };
}

describe("step 1: the request names a format", () => {
  it("uses the format argument", async () => {
    const chosen = await resolveOutputFormat(chartRequest({ format: "docx" }), contextWith({}));
    expect(chosen).toEqual({ format: "docx", source: "request" });
  });

  it("uses the extension of the output path, before the format argument", () => {
    const request = chartRequest({ outputPath: "out/sales.XLSX", format: "pdf" });
    expect(settledOutputFormat(request, contextWith({}))).toEqual({
      format: "xlsx",
      source: "request",
    });
  });

  it("wins over the session and the config", () => {
    const context = contextWith({ sessionFormat: "pdf" }, "png");
    expect(settledOutputFormat(chartRequest({ format: "svg" }), context)?.format).toBe("svg");
  });

  it("refuses a format that cannot hold this output, with the tool's own advice", () => {
    expect(() => settledOutputFormat(chartRequest({ format: "csv" }), contextWith({}))).toThrow(
      new ToolError("csv cannot hold a chart; use export_table."),
    );
  });

  it("ignores an extension that is not a format", () => {
    const request = chartRequest({ outputPath: "out/sales.final", format: "png" });
    expect(settledOutputFormat(request, contextWith({}))?.format).toBe("png");
  });
});

describe("D86: a format the user did not name is the model's guess", () => {
  it("does not let a guessed format skip the session format", () => {
    const context = contextWith({ sessionFormat: "docx", namedByUser: [] });
    expect(settledOutputFormat(chartRequest({ format: "pdf" }), context)).toEqual({
      format: "docx",
      source: "session",
    });
  });

  it("does not let a guessed format or path extension skip the question", async () => {
    const { context, questions } = asking("xlsx", { namedByUser: ["png"] });
    const request = chartRequest({ format: "pdf", outputPath: "~/Desktop/chart.pdf" });
    expect(await resolveOutputFormat(request, context)).toEqual({ format: "xlsx", source: "user" });
    expect(questions).toHaveLength(1);
  });

  it("keeps the format the user did name", () => {
    const context = contextWith({ sessionFormat: "docx", namedByUser: ["pdf", "xlsx"] });
    expect(settledOutputFormat(chartRequest({ format: "pdf" }), context)?.source).toBe("request");
  });

  it("takes the argument the user named when the path's extension was a guess", () => {
    const context = contextWith({ namedByUser: ["docx"] });
    const request = chartRequest({ outputPath: "report.pdf", format: "docx" });
    expect(settledOutputFormat(request, context)?.format).toBe("docx");
  });

  it("trusts the arguments when the user's words are unknown", () => {
    expect(settledOutputFormat(chartRequest({ format: "pdf" }), contextWith(undefined))).toEqual({
      format: "pdf",
      source: "request",
    });
  });
});

describe("steps 2 and 3: the session, then the config", () => {
  it("uses the session format before the config default", () => {
    const context = contextWith({ sessionFormat: "png" }, "pdf");
    expect(settledOutputFormat(chartRequest(), context)).toEqual({
      format: "png",
      source: "session",
    });
  });

  it("uses the config default when the session has none", () => {
    expect(settledOutputFormat(chartRequest(), contextWith({}, "docx"))).toEqual({
      format: "docx",
      source: "config",
    });
    expect(settledOutputFormat(chartRequest(), contextWith(undefined, "docx"))?.format).toBe(
      "docx",
    );
  });

  it("skips a session or config format that cannot hold this output", () => {
    const table: FormatRequest = { ...chartRequest(), what: "table", allowed: tableOutputFormats };
    expect(settledOutputFormat(table, contextWith({ sessionFormat: "png" }, "pdf"))).toEqual({
      format: "pdf",
      source: "config",
    });
    expect(
      settledOutputFormat(table, contextWith({ sessionFormat: "png" }, "svg")),
    ).toBeUndefined();
  });

  it("is unset by default, so nothing is settled without the user", () => {
    expect(defaultConfig().output.defaultFormat).toBeUndefined();
    expect(settledOutputFormat(chartRequest(), contextWith({}))).toBeUndefined();
  });
});

describe("step 4: the user is asked", () => {
  it("asks with the formats that hold the output and uses the pick", async () => {
    const { context, questions } = asking("docx");
    expect(await resolveOutputFormat(chartRequest(), context)).toEqual({
      format: "docx",
      source: "user",
    });
    expect(questions).toEqual([{ what: "chart", formats: chartOutputFormats }]);
  });

  it("offers fewer formats when the call says so", async () => {
    const { context, questions } = asking("pdf");
    await resolveOutputFormat(chartRequest({ offered: ["pdf", "docx", "xlsx"] }), context);
    expect(questions[0]?.formats).toEqual(["pdf", "docx", "xlsx"]);
  });

  it("does not ask when a format is already settled", async () => {
    const { context, questions } = asking("docx", { sessionFormat: "pdf" });
    expect((await resolveOutputFormat(chartRequest(), context)).format).toBe("pdf");
    expect(questions).toEqual([]);
  });

  it("saves nothing when the user closes the question", async () => {
    const { context } = asking(undefined);
    await expect(resolveOutputFormat(chartRequest(), context)).rejects.toThrow(
      /closed the format question without choosing, so nothing was saved.*pdf, docx, xlsx, png, svg/,
    );
  });
});

describe("nobody can be asked (one-shot mode, D14)", () => {
  it("fails with the formats and the --format flag", async () => {
    const error = await resolveOutputFormat(chartRequest(), contextWith({})).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(ToolError);
    const message = (error as Error).message;
    expect(message).toContain("No output format was chosen for this chart");
    expect(message).toContain("pdf, docx, xlsx, png, svg");
    expect(message).toContain("--format <name>");
    expect(message).toContain("Do not call the tool again");
    // Short enough to sit well inside a tool result cap.
    expect(message.length).toBeLessThan(400);
  });

  it("says that a guessed format was not used", async () => {
    const context = contextWith({ namedByUser: [] });
    await expect(resolveOutputFormat(chartRequest({ format: "pdf" }), context)).rejects.toThrow(
      /"pdf" was not used: the user's message does not name it\./,
    );
  });

  it("says when the format in use cannot hold this output", async () => {
    const table: FormatRequest = { ...chartRequest(), what: "table", allowed: tableOutputFormats };
    await expect(resolveOutputFormat(table, contextWith({ sessionFormat: "png" }))).rejects.toThrow(
      /The format in use, png, cannot hold a table\..*xlsx, docx, pdf, csv/,
    );
  });
});
