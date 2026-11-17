// `clankr index` as a real process: the real entry point, config file, LM Studio client, and
// DuckDB index, against the fake LM Studio server. This is where the token header, the task
// prefix, a real Ctrl+C (SIGINT), and the MOD-8 style error are seen on the wire.
// Nothing here touches the real ~/.clankr or the real LM Studio.

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FakeLmStudioServer,
  type FakeServerOptions,
} from "../../src/lmstudio/fake-lm-studio-server.test-support.ts";

const mainPath = fileURLToPath(new URL("../../src/cli/main.ts", import.meta.url));
const embeddingModel = "text-embedding-nomic-embed-text-v1.5";
const token = "sk-lm-index-test-token";

let scratch: string;
let server: FakeLmStudioServer | undefined;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "clankr-index-process-"));
  await mkdir(join(scratch, "docs"));
});

afterEach(async () => {
  await server?.stop();
  server = undefined;
  await rm(scratch, { recursive: true, force: true });
});

async function startServer(options: FakeServerOptions = {}, search: object = {}): Promise<void> {
  server = new FakeLmStudioServer({
    requiredToken: token,
    models: [{ key: "test/chat" }, { key: embeddingModel, type: "embedding" }],
    ...options,
  });
  const baseUrl = await server.start();
  await mkdir(join(scratch, "home"), { recursive: true });
  await writeFile(
    join(scratch, "home", "config.json"),
    JSON.stringify({ lmStudio: { baseUrl, apiToken: token }, search }),
  );
}

interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `clankr <argv>` in the scratch folder. `onStderr` sees progress as it is written. */
function runClankr(argv: string[], onStderr?: (text: string, interrupt: () => void) => void) {
  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", "--no-node-snapshot", mainPath, ...argv],
      {
        cwd: scratch,
        env: { ...process.env, CLANKR_HOME: join(scratch, "home"), LM_API_TOKEN: "" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      onStderr?.(stderr, () => child.kill("SIGINT"));
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

describe("clankr index, as a process", () => {
  it("embeds through LM Studio with the token and the document prefix, then lists the index", async () => {
    await startServer();
    await writeFile(join(scratch, "docs", "lease.md"), "Either party may end the lease early.\n");
    await writeFile(join(scratch, "docs", "soup.txt"), "Simmer the broth slowly.\n");

    const indexed = await runClankr(["index", "docs"]);

    expect(indexed.stderr).not.toMatch(/Error|clankr: /);
    expect(indexed.exitCode).toBe(0);
    expect(indexed.stdout).toMatch(/2 files read \(2 passages\), 0 unchanged, 0 removed\./);
    const embeddings = (server?.requests ?? []).filter(
      (request) => request.path === "/v1/embeddings",
    );
    expect(embeddings.length).toBeGreaterThanOrEqual(2);
    for (const request of embeddings) {
      expect(request.authorization).toBe(`Bearer ${token}`);
      expect(request.body).toMatchObject({ model: embeddingModel });
    }
    expect(embeddings.at(-1)?.body).toMatchObject({
      input: [
        "search_document: Either party may end the lease early.",
        "search_document: Simmer the broth slowly.",
      ],
    });
    expect(indexed.stdout + indexed.stderr).not.toContain(token);

    const status = await runClankr(["index", "--status"]);
    expect(status.exitCode).toBe(0);
    expect(status.stdout).toMatch(/docs · 2 files · 2 passages · indexed just now/);
  });

  it("fails with the fix when the embedding model is not downloaded, and creates no index", async () => {
    await startServer({}, { embeddingModel: "nomic/not-downloaded" });
    await writeFile(join(scratch, "docs", "note.md"), "A note.\n");

    const result = await runClankr(["index", "docs"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(
      /The embedding model "nomic\/not-downloaded" is not downloaded in LM Studio\. Downloaded embedding models: text-embedding-nomic-embed-text-v1\.5\.\nFix: Download it with `lms get nomic\/not-downloaded`/,
    );
    expect((await runClankr(["index", "--status"])).stdout).toMatch(/No folder is indexed/);
  });

  it("stops on Ctrl+C with a usable index, and the next run finishes it", async () => {
    await startServer({ embeddingDelayMs: 40 }, { embeddingBatchSize: 1 });
    const fileCount = 60;
    for (let index = 0; index < fileCount; index++) {
      const name = `note-${String(index).padStart(2, "0")}.md`;
      await writeFile(join(scratch, "docs", name), `Note number ${index}.\n`);
    }

    let interrupted = false;
    const cancelled = await runClankr(["index", "docs"], (stderr, interrupt) => {
      if (interrupted || !/Indexing: \d+ of 60 files/.test(stderr)) return;
      interrupted = true;
      interrupt();
    });

    expect(cancelled.exitCode).toBe(130);
    expect(cancelled.stdout).toMatch(
      /cancelled.*What was stored is kept; run it again to continue\./,
    );
    const stored = Number(/now holds (\d+) files?/.exec(cancelled.stdout)?.[1]);
    expect(stored).toBeGreaterThanOrEqual(1);
    expect(stored).toBeLessThan(fileCount);
    expect((await runClankr(["index", "--status"])).stdout).toMatch(
      new RegExp(`docs · ${stored} files? · ${stored} passages? · .* · unfinished`),
    );

    const finished = await runClankr(["index", "docs"]);
    expect(finished.exitCode).toBe(0);
    expect(finished.stdout).toMatch(
      new RegExp(`${fileCount - stored} files? read .*, ${stored} unchanged, 0 removed\\.`),
    );
    expect(finished.stdout).toMatch(/now holds 60 files and 60 passages/);
  }, 60_000);
});
