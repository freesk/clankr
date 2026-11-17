import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts", "evals/**/*.test.ts"],
    environment: "node",
    // Browser launches and the first DuckDB load in a worker took over 5 s while the machine
    // was busy (ROADMAP, load-sensitive tests); they pass in well under a second otherwise.
    testTimeout: 20_000,
  },
});
