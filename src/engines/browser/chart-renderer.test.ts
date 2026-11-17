import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Theme } from "../../contracts/index.ts";
import {
  type ChartRenderer,
  createChartRenderer,
  exportScale,
  isBrowserVendored,
} from "./index.ts";
import { pdfImageCount, pdfPageCount, pdfPageSize, pdfText, pngSize } from "./test-support.ts";

// The browser's DOMParser, used inside page.evaluate. The project compiles without DOM types.
interface ParsedXml {
  documentElement: { getAttribute(name: string): string | null };
  querySelector(selector: string): unknown;
}
declare const DOMParser: new () => { parseFromString(text: string, type: string): ParsedXml };

const theme: Theme = {
  palette: ["#4e79a7", "#f28e2b"],
  fontFamily: "Helvetica Neue",
  page: { size: "A4", orientation: "landscape" },
};

const barSpec = {
  title: "Revenue by region",
  mark: "bar",
  encoding: {
    x: { field: "region", type: "nominal" },
    y: { field: "revenue", type: "quantitative" },
  },
  config: { font: "Helvetica Neue" },
};

const rows = [
  { region: "North", revenue: 120 },
  { region: "South", revenue: 80 },
  { region: "East", revenue: 95 },
];

// A 1x1 PNG, used as the theme logo.
const logoPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

describe.skipIf(!isBrowserVendored())("chart renderer (needs `npm run vendor`)", () => {
  let renderer: ChartRenderer;
  let folder: string;

  beforeAll(async () => {
    renderer = createChartRenderer({ idleMilliseconds: 60_000 });
    folder = await mkdtemp(join(tmpdir(), "clankr-render-"));
  });

  afterAll(async () => {
    await renderer.close();
    await rm(folder, { recursive: true, force: true });
  });

  it("renders a one-page PDF with the theme's page size", async () => {
    const outputPath = join(folder, "bar.pdf");
    const result = await renderer.renderChart({
      spec: barSpec,
      rows,
      theme,
      format: "pdf",
      outputPath,
    });
    const pdf = await readFile(outputPath);
    expect(result.sizeBytes).toBe(pdf.length);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdfPageCount(pdf)).toBe(1);
    // A4 landscape is 842 x 595 points.
    const size = pdfPageSize(pdf);
    expect(Math.round(size.width)).toBe(843);
    expect(Math.round(size.height)).toBe(596);
    expect(pdfText(pdf)).toContain("Revenuebyregion");
  });

  it("uses Letter portrait when the theme asks for it", async () => {
    const outputPath = join(folder, "letter.pdf");
    const letter: Theme = { ...theme, page: { size: "Letter", orientation: "portrait" } };
    await renderer.renderChart({ spec: barSpec, rows, theme: letter, format: "pdf", outputPath });
    const size = pdfPageSize(await readFile(outputPath));
    expect(Math.round(size.width)).toBe(612);
    expect(Math.round(size.height)).toBe(792);
  });

  it("exports an SVG that parses and a PNG at the fixed scale", async () => {
    const svgPath = join(folder, "bar.svg");
    const pngPath = join(folder, "bar.png");
    await renderer.renderChart({ spec: barSpec, rows, theme, format: "svg", outputPath: svgPath });
    await renderer.renderChart({ spec: barSpec, rows, theme, format: "png", outputPath: pngPath });

    const svg = await readFile(svgPath, "utf8");
    const parsed = await renderer.session.withRenderPage((page) =>
      page.evaluate((text) => {
        const document = new DOMParser().parseFromString(text, "image/svg+xml");
        const root = document.documentElement;
        return {
          error: document.querySelector("parsererror") !== null,
          width: Number(root.getAttribute("width")),
          height: Number(root.getAttribute("height")),
        };
      }, svg),
    );
    expect(parsed.error).toBe(false);
    expect(parsed.width).toBeGreaterThan(0);

    const png = await readFile(pngPath);
    expect(pngSize(png)).toEqual({
      width: parsed.width * exportScale,
      height: parsed.height * exportScale,
    });
  });

  it("puts the theme's logo and footer in the PDF", async () => {
    const logoPath = join(folder, "logo.png");
    await writeFile(logoPath, logoPng);
    const decorated: Theme = { ...theme, logoPath, footer: "Acme Finance <confidential>" };
    const outputPath = join(folder, "decorated.pdf");
    await renderer.renderChart({
      spec: barSpec,
      rows,
      theme: decorated,
      format: "pdf",
      outputPath,
    });
    const pdf = await readFile(outputPath);
    expect(pdfImageCount(pdf)).toBeGreaterThanOrEqual(1);
    expect(pdfText(pdf)).toContain("AcmeFinance<confidential>");
    expect(pdfPageCount(pdf)).toBe(1);
  });

  it("falls back to the system font, with a note, when the theme font is missing", async () => {
    const missingFont: Theme = { ...theme, fontFamily: "No Such Font 12345" };
    const spec = { ...barSpec, config: { font: "No Such Font 12345" } };
    const result = await renderer.renderChart({
      spec,
      rows,
      theme: missingFont,
      format: "svg",
      outputPath: join(folder, "font.svg"),
    });
    expect(result.notes?.join(" ")).toMatch(/No Such Font 12345.*not installed/);
    const svg = await readFile(result.path, "utf8");
    expect(svg).toContain("Helvetica Neue");
    expect(svg).not.toContain("No Such Font");
  });

  it("evaluates spec expressions under the content security policy", async () => {
    const spec = {
      mark: "bar",
      transform: [
        { calculate: "datum.revenue * 2", as: "doubled" },
        { filter: "datum.doubled > 170" },
      ],
      encoding: {
        x: { field: "region", type: "nominal" },
        y: { field: "doubled", type: "quantitative" },
      },
    };
    const result = await renderer.renderChart({
      spec,
      rows,
      theme,
      format: "svg",
      outputPath: join(folder, "expression.svg"),
    });
    const svg = await readFile(result.path, "utf8");
    // North (240) and East (190) pass the filter; South (160) does not.
    expect(svg).toContain("North");
    expect(svg).toContain("East");
    expect(svg).not.toContain("South");
  });

  it("draws markup in a spec as inert text", async () => {
    const before = renderer.blockedRequests.length;
    const markup = '<img src=x onerror="fetch(\'/pwned-title\')"><script>fetch("/pwned")</script>';
    const result = await renderer.renderChart({
      spec: { ...barSpec, title: markup },
      rows: [{ region: markup, revenue: 1 }],
      theme,
      format: "svg",
      outputPath: join(folder, "markup.svg"),
    });
    const svg = await readFile(result.path, "utf8");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).not.toContain("<script");
    expect(pwnedRequests(before)).toEqual([]);
  });

  it("refuses an expression that tries to reach the Function constructor", async () => {
    const before = renderer.blockedRequests.length;
    const hostile = {
      ...barSpec,
      transform: [{ calculate: "constructor.constructor('fetch(\"/pwned\")')()", as: "x" }],
    };
    await expect(
      renderer.renderChart({
        spec: hostile,
        rows,
        theme,
        format: "svg",
        outputPath: join(folder, "hostile.svg"),
      }),
    ).rejects.toThrow();
    expect(pwnedRequests(before)).toEqual([]);
  });

  function pwnedRequests(since: number) {
    return renderer.blockedRequests.slice(since).filter((request) => request.url.includes("pwned"));
  }

  it("composes charts and text into one report PDF", async () => {
    const outputPath = join(folder, "report.pdf");
    const blocks = [
      { kind: "heading" as const, text: "Quarterly review" },
      { kind: "paragraph" as const, text: "Revenue rose in the north." },
      { kind: "chart" as const, spec: barSpec, rows },
      { kind: "chart" as const, spec: { ...barSpec, mark: "line" }, rows },
      { kind: "chart" as const, spec: { ...barSpec, mark: "point" }, rows },
    ];
    await renderer.renderReport(blocks, { ...theme, footer: "Report footer" }, outputPath);
    const pdf = await readFile(outputPath);
    const text = pdfText(pdf);
    expect(text).toContain("Quarterlyreview");
    expect(text).toContain("Revenueroseinthenorth.");
    expect(text).toContain("Reportfooter");
    // Three half-page charts cannot share one page.
    expect(pdfPageCount(pdf)).toBeGreaterThanOrEqual(2);
  });

  it("renders a PNG preview without writing a file", async () => {
    const preview = await renderer.renderPreview(barSpec, rows, theme);
    expect(preview.subarray(1, 4).toString()).toBe("PNG");
    expect(pngSize(preview).width).toBeGreaterThan(0);
  });

  it("never overwrites an existing file", async () => {
    const outputPath = join(folder, "taken.svg");
    await writeFile(outputPath, "keep me");
    await expect(
      renderer.renderChart({ spec: barSpec, rows, theme, format: "svg", outputPath }),
    ).rejects.toThrow(/EEXIST/);
    expect(await readFile(outputPath, "utf8")).toBe("keep me");
  });
});
