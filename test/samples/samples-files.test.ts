// The committed samples are exactly what `npm run samples` writes, stay small, and
// are each described in samples/README.md.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sampleFiles } from "../../evals/fixtures/samples/catalog.ts";
import { samplesDirectory } from "./sample-kit.ts";

const maximumFileBytes = 1024 * 1024;
const maximumTotalBytes = 3 * 1024 * 1024;

describe("committed samples", () => {
  it("has at least five sample files", () => {
    expect(sampleFiles.length).toBeGreaterThanOrEqual(5);
  });

  it.each(sampleFiles)("$name matches the generator byte for byte", async (sample) => {
    const committed = await readFile(join(samplesDirectory, sample.name));
    const generated = sample.render();
    // Compare lengths first so a mismatch does not print two large buffers.
    expect(committed.length).toBe(generated.length);
    expect(committed.equals(generated), "run npm run samples and commit the result").toBe(true);
  });

  it("renders the same bytes twice in one process", () => {
    for (const sample of sampleFiles) expect(sample.render().equals(sample.render())).toBe(true);
  });

  it("keeps each file under 1 MB and all of them under 3 MB", async () => {
    let total = 0;
    for (const sample of sampleFiles) {
      const size = (await readFile(join(samplesDirectory, sample.name))).length;
      expect(size, sample.name).toBeLessThan(maximumFileBytes);
      total += size;
    }
    expect(total).toBeLessThan(maximumTotalBytes);
  });

  it("describes every sample in the README", async () => {
    const readme = await readFile(join(samplesDirectory, "README.md"), "utf8");
    for (const sample of sampleFiles) expect(readme).toContain(`\`${sample.name}\``);
  });
});
