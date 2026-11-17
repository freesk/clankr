import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "./index.ts";
import { ConfigError, loadConfig } from "./load.ts";

describe("loadConfig", () => {
  let directory: string;
  let configFilePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "vix-config-"));
    configFilePath = join(directory, "config.json");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("uses PRD defaults when the file is missing", async () => {
    const config = await loadConfig({ configFilePath, workingDirectory: "/work" });
    expect(config.lmStudio.baseUrl).toBe("http://localhost:1234");
    expect(config.model.default).toBe("google/gemma-4-12b-qat");
    expect(config.model.contextLength).toBe(16_384);
    expect(config.permissions.mode).toBe("ask");
    expect(config.permissions.allowedRoots).toEqual(["/work"]);
    expect(config.context.defaultResultTokenCap).toBe(800);
    expect(config.context.budgetShares.fixedOverhead).toBe(0.1);
  });

  it("layers file, then environment, then flags", async () => {
    await writeFile(
      configFilePath,
      JSON.stringify({
        model: { default: "from-file", contextLength: 8192 },
        lmStudio: { apiToken: "file-token" },
      }),
    );
    const config = await loadConfig({
      configFilePath,
      workingDirectory: "/work",
      environment: { LM_API_TOKEN: "env-token" },
      flags: { model: "from-flag", permissionMode: "read-only" },
    });
    expect(config.model.default).toBe("from-flag");
    expect(config.model.contextLength).toBe(8192);
    expect(config.lmStudio.apiToken).toBe("env-token");
    expect(config.permissions.mode).toBe("read-only");
  });

  it("resolves relative allowed roots against the working directory", async () => {
    await writeFile(
      configFilePath,
      JSON.stringify({ permissions: { allowedRoots: ["notes", "/abs"] } }),
    );
    const config = await loadConfig({ configFilePath, workingDirectory: "/work" });
    expect(config.permissions.allowedRoots).toEqual(["/work/notes", "/abs"]);
  });

  it("reports invalid fields without echoing values", async () => {
    await writeFile(
      configFilePath,
      JSON.stringify({ lmStudio: { apiToken: "" }, model: { contextLength: -1 } }),
    );
    const loading = loadConfig({ configFilePath, workingDirectory: "/work" });
    await expect(loading).rejects.toBeInstanceOf(ConfigError);
    await expect(loading).rejects.toThrow(/model\.contextLength/);
  });

  it("reports a file that is not JSON", async () => {
    await writeFile(configFilePath, "{ nope");
    await expect(loadConfig({ configFilePath, workingDirectory: "/work" })).rejects.toThrow(
      /not valid JSON/,
    );
  });

  it("exposes defaults without any input", () => {
    expect(defaultConfig().subagents.turnLimit).toBe(8);
  });
});
