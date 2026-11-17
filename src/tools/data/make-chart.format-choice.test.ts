// How make_chart settles the output format (D85, D86): the request, the session, the config,
// the question, and the error where nobody can be asked. The order itself is tested in
// src/output/resolve-format.test.ts; this file checks what the tool does with it.

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SelfCheckVerdict } from "../../chart/index.ts";
import type { OutputFormat, OutputFormatContext, ToolContext } from "../../contracts/index.ts";
import { isBrowserVendored } from "../../engines/browser/index.ts";
import { type ChartTestKit, createChartTestKit } from "./testing/chart-test-kit.ts";

describe.skipIf(!isBrowserVendored())(
  "make_chart format choice (needs the vendored schema)",
  () => {
    let kit: ChartTestKit;

    beforeEach(async () => {
      kit = await createChartTestKit();
    });

    afterEach(async () => {
      await kit.cleanup();
    });

    function withFormats(outputFormat: OutputFormatContext): ToolContext {
      return { ...kit.context, outputFormat };
    }

    /** A context whose format question records what it offered and answers with `answer`. */
    function asking(answer: OutputFormat | undefined, extra: OutputFormatContext = {}) {
      const offered: (readonly OutputFormat[])[] = [];
      const asked = withFormats({
        ...extra,
        ask: async (question) => {
          offered.push(question.formats);
          return answer;
        },
      });
      return { asked, offered };
    }

    async function filesWritten(): Promise<string[]> {
      return (await readdir(kit.folder)).filter((name) => name !== "pay.csv").sort();
    }

    it("asks when nothing names a format, and writes what the user picks", async () => {
      const { asked, offered } = asking("docx");
      const preview = await kit.tool().previewChange?.({ code: kit.oneChart }, asked);
      expect(preview?.summary).toBe(
        `Run chart code and save a chart in ${kit.folder} (you choose the format next)`,
      );
      const output = await kit.tool().run({ code: kit.oneChart }, asked);
      expect(offered).toEqual([["pdf", "docx", "xlsx", "png", "svg"]]);
      expect(output.text).toContain(join(kit.folder, "pay-by-department.docx"));
    });

    it("offers several charts only the formats that hold several", async () => {
      const { asked, offered } = asking("pdf");
      await kit.tool().run({ code: kit.twoCharts }, asked);
      expect(offered).toEqual([["pdf", "docx", "xlsx"]]);
      expect(kit.renderer.pageRequests).toHaveLength(1);
    });

    it("does not ask about a chart that fails, or one whose self-check fails", async () => {
      const { asked, offered } = asking("pdf");
      const broken = `render({ mark: "bars" }, data("${kit.handle}"));`;
      await expect(kit.tool().run({ code: broken }, asked)).rejects.toThrow(/spec is invalid/);

      const verdict: SelfCheckVerdict = { passed: false, verdict: "Labels overlap." };
      const checked = kit.tool({ selfCheck: async () => verdict });
      const output = await checked.run({ code: kit.oneChart }, asked);
      expect(output.text).toContain("Self-check failed");
      expect(offered).toEqual([]);
      expect(await filesWritten()).toEqual([]);
    });

    it("asks instead of using a format the model guessed (D86)", async () => {
      const { asked, offered } = asking("xlsx", { namedByUser: [] });
      const output = await kit
        .tool()
        .run({ code: kit.oneChart, format: "pdf", output_path: "chart.pdf" }, asked);
      expect(offered).toHaveLength(1);
      // The guessed extension goes with the guessed format; the name and folder are kept.
      expect(output.text).toContain(join(kit.context.workingDirectory, "chart.xlsx"));
    });

    it("uses the format the user named, without asking", async () => {
      const { asked, offered } = asking("xlsx", { namedByUser: ["png"], sessionFormat: "pdf" });
      const output = await kit.tool().run({ code: kit.oneChart, format: "png" }, asked);
      expect(output.text).toContain("pay-by-department.png");
      expect(offered).toEqual([]);
    });

    it("uses the session format, then the config default, without asking", async () => {
      const { asked, offered } = asking("svg", { sessionFormat: "png" });
      const fromSession = await kit.tool().run({ code: kit.oneChart }, asked);
      expect(fromSession.text).toContain("pay-by-department.png");

      kit.context.config.output.defaultFormat = "svg";
      const fromConfig = await kit.tool().run({ code: kit.oneChart }, kit.context);
      // The first chart's companion files hold the plain name, so this one is numbered (D28).
      expect(fromConfig.text).toContain("pay-by-department-2.svg");
      expect(offered).toEqual([]);
    });

    it("fails where nobody can be asked, naming the formats and --format", async () => {
      await expect(kit.tool().run({ code: kit.oneChart }, kit.context)).rejects.toThrow(
        /No output format was chosen for this chart.*pdf, docx, xlsx, png, svg.*--format <name>/,
      );
      expect(await filesWritten()).toEqual([]);
    });

    it("saves nothing when the user closes the question", async () => {
      const { asked } = asking(undefined);
      await expect(kit.tool().run({ code: kit.oneChart }, asked)).rejects.toThrow(
        /closed the format question/,
      );
      expect(await filesWritten()).toEqual([]);
    });

    it("refuses several charts in a session format that holds one", async () => {
      await expect(
        kit.tool().run({ code: kit.twoCharts }, withFormats({ sessionFormat: "svg" })),
      ).rejects.toThrow(/SVG holds one chart, and the code rendered 2/);
    });

    it("points a csv request at export_table", async () => {
      await expect(
        kit.tool().run({ code: kit.oneChart, format: "csv" }, kit.context),
      ).rejects.toThrow(/CSV holds a table, not a chart\. Use export_table/);
    });
  },
);
