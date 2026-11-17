// `npm run evals:fixtures`: generates the large fixtures on demand into the
// fixture cache, so the first eval run does not pay for them. Never committed.

import { stat } from "node:fs/promises";
import { defaultFixtureCacheDirectory, ensureCachedCsv } from "./fixtures/materialize.ts";

const millionRowSales = { dataset: "sales", rows: 1_000_000, sheetName: "Sheet1" } as const;

const startedAt = performance.now();
const path = await ensureCachedCsv(millionRowSales, defaultFixtureCacheDirectory);
const sizeMegabytes = (await stat(path)).size / 1024 / 1024;
const seconds = (performance.now() - startedAt) / 1000;
console.log(`${path}: ${sizeMegabytes.toFixed(1)} MB, ready in ${seconds.toFixed(1)} s`);
