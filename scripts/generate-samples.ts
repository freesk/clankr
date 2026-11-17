// `npm run samples`: regenerates the committed sample files in samples/ from the
// seeded data in evals/fixtures/samples/. The output is byte-identical on every run.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sampleFiles } from "../evals/fixtures/samples/catalog.ts";

const samplesDirectory = join(import.meta.dirname, "..", "samples");

await mkdir(samplesDirectory, { recursive: true });
for (const sample of sampleFiles) {
  const content = sample.render();
  await writeFile(join(samplesDirectory, sample.name), content);
  console.log(`samples/${sample.name}: ${(content.length / 1024).toFixed(1)} KB`);
}
