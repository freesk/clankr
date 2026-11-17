// Shared fixtures for the semantic part's tests: a temporary folder of documents with a
// private clankr root beside it, a scripted model that returns deterministic vectors, and a
// builder for small PDFs with a real text layer. Test code only: excluded from the build.

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type ConfigInput, configSchema } from "../config/index.ts";
import type {
  Config,
  IndexOutcome,
  IndexProgress,
  IndexRequest,
  ToolContext,
} from "../contracts/index.ts";
import {
  createTestToolContext,
  FixedPathPolicy,
  ScriptedLmClient,
  type TestToolContext,
} from "../testing/index.ts";
import type { Extractors } from "./extract/index.ts";
import { type IndexEnvironment, runIndexRequest } from "./index-requests.ts";

export interface IndexWorkspace {
  /** The folder the tests index. Its real path, so it matches what the index records. */
  documents: string;
  indexDirectory: string;
  config: Config;
  lm: ScriptedLmClient;
  /** Everything `print` received, one entry per call. */
  printed: string[];
  progress: IndexProgress[];
  /** Writes a file under `documents`, creating its folders. */
  write(relativePath: string, content: string | Uint8Array): Promise<string>;
  /** Runs one index request the way `clankr index` does. */
  run(request: IndexRequest, overrides?: Partial<IndexEnvironment>): Promise<IndexOutcome>;
  /** Shorthand for a build request on `documents`. */
  index(overrides?: Partial<IndexEnvironment>): Promise<IndexOutcome>;
  /** A tool context that reads this workspace's indexes. */
  toolContext(overrides?: Partial<ToolContext>): ToolContext;
  cleanup(): Promise<void>;
}

export interface IndexWorkspaceOptions {
  config?: ConfigInput;
  /** Paths the policy denies, relative to `documents` or absolute. */
  deniedPaths?: string[];
  extractors?: Extractors;
}

export async function createIndexWorkspace(
  options: IndexWorkspaceOptions = {},
): Promise<IndexWorkspace> {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), "clankr-semantic-")));
  const documents = join(scratch, "documents");
  await mkdir(documents);
  const tool: TestToolContext = await createTestToolContext({ workingDirectory: documents });
  const config = configSchema.parse(options.config ?? {});
  const lm = new ScriptedLmClient();
  const paths = new FixedPathPolicy({
    allowedRoots: [documents],
    deniedPaths: (options.deniedPaths ?? []).map((path) => join(documents, path)),
    workingDirectory: documents,
  });
  const printed: string[] = [];
  const progress: IndexProgress[] = [];
  const indexDirectory = tool.context.clankrPaths.indexDirectory;

  const run: IndexWorkspace["run"] = (request, overrides = {}) =>
    runIndexRequest(request, {
      config,
      lm,
      paths,
      indexDirectory,
      signal: new AbortController().signal,
      print: (text) => printed.push(text),
      showProgress: (step) => progress.push(step),
      ...(options.extractors ? { extractors: options.extractors } : {}),
      ...overrides,
    });

  return {
    documents,
    indexDirectory,
    config,
    lm,
    printed,
    progress,
    run,
    index: (overrides) => run({ action: "build", folder: documents, rebuild: false }, overrides),
    async write(relativePath, content) {
      const path = join(documents, relativePath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
      return path;
    },
    toolContext: (overrides = {}) => ({ ...tool.context, config, lm, paths, ...overrides }),
    async cleanup() {
      await tool.cleanup();
      await rm(scratch, { recursive: true, force: true });
    },
  };
}

/** Where `node_modules` is, so a child process can load DuckDB. */
const repositoryRoot = resolve(import.meta.dirname, "..", "..");

/** Runs in a separate process: opens the index for writing and holds it until stdin closes. */
const lockHolderScript = `
import { DuckDBInstance } from "@duckdb/node-api";
await DuckDBInstance.create(process.argv[1]);
console.log("locked");
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
`;

/**
 * Holds an index file the way a running `clankr index` in another terminal does. DuckDB's
 * lock is per process, so this needs a real second process. Returns the function that lets go.
 */
export async function holdIndexFromAnotherProcess(indexFile: string): Promise<() => Promise<void>> {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", lockHolderScript, indexFile],
    { cwd: repositoryRoot, stdio: ["pipe", "pipe", "inherit"] },
  );
  await new Promise<void>((resolveLocked, reject) => {
    child.stdout.once("data", () => resolveLocked());
    child.once("error", reject);
    child.once("close", () => reject(new Error("the lock holder exited before locking")));
  });
  return () =>
    new Promise<void>((resolveReleased) => {
      child.once("close", () => resolveReleased());
      child.stdin.end();
    });
}

/**
 * A PDF with one page per entry and one line of text per string, in Helvetica. Small and
 * hand-built, but a real PDF: PDF.js reads its text layer like any other.
 */
export function buildPdf(pages: string[][]): Uint8Array {
  const objects: string[] = [];
  const add = (body: string): number => objects.push(body);
  const catalogId = add("");
  const pagesId = add("");
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds = pages.map((lines) => {
    const content = lines
      .map((line, index) => `BT /F1 12 Tf 72 ${720 - index * 16} Td (${escapePdfText(line)}) Tj ET`)
      .join("\n");
    const contentId = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    return add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
    );
  });
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  const kids = pageIds.map((id) => `${id} 0 R`).join(" ");
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids}] /Count ${pageIds.length} >>`;

  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const crossReference = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`);
  const trailer = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${crossReference.join("")}trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${body.length}\n%%EOF\n`;
  return Buffer.from(body + trailer, "latin1");
}

function escapePdfText(text: string): string {
  return text.replace(/([()\\])/g, "\\$1");
}
