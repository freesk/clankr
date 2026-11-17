// Toy tools for the scripted harness. They mimic only the outcome that the
// golden assertions check: a written file, or a PDF with its spec beside it.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { renderPdf } from "../fixtures/generators/pdf.ts";
import type { ToyTool } from "./scripted-harness.ts";

export const toyWriteFile: ToyTool = {
  name: "write_file",
  async run(args, workingDirectory) {
    const path = join(workingDirectory, String(args.path));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, String(args.content ?? ""));
    return `wrote ${args.path}`;
  },
};

/** Fails unless the spec has a mark, so tests can script failed chart attempts. */
export const toyMakeChart: ToyTool = {
  name: "make_chart",
  async run(args, workingDirectory) {
    const spec = args.spec as Record<string, unknown> | undefined;
    if (!spec?.mark) throw new Error("spec.mark is required");
    const output = join(workingDirectory, String(args.output ?? "chart.pdf"));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, renderPdf({ lines: ["chart"] }));
    await writeFile(`${output}.vl.json`, JSON.stringify(spec));
    return `saved ${args.output}`;
  },
};

/** Stands in for any read tool a task requires but the test does not exercise. */
export function toyNoOp(name: string): ToyTool {
  return { name, run: async () => "ok" };
}
