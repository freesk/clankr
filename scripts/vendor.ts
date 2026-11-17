// `npm run vendor`: installs every pinned third-party asset into vendor/.
// Pass step names to install only those, for example `npm run vendor -- ripgrep`.

import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { resetDirectory } from "./vendor/step.ts";
import { vendorSteps } from "./vendor/steps.ts";

const vendorDirectory = resolve(import.meta.dirname, "..", "vendor");
const requested = process.argv.slice(2);
const steps =
  requested.length === 0
    ? vendorSteps
    : vendorSteps.filter((step) => requested.includes(step.name));

const unknown = requested.filter((name) => !vendorSteps.some((step) => step.name === name));
if (unknown.length > 0) {
  console.error(`Unknown vendor step(s): ${unknown.join(", ")}`);
  process.exit(2);
}

if (steps.length === 0) console.log("No vendor steps registered yet.");

for (const step of steps) {
  const targetDirectory = join(vendorDirectory, step.name);
  console.log(`vendor: ${step.name} ${step.version}`);
  await resetDirectory(targetDirectory);
  await step.install(targetDirectory);
  await writeFile(join(targetDirectory, "VERSION"), `${step.version}\n`);
}
