// A small file tree for the search tests: text, binary, excluded, denied, deep, and
// long-line files, with chosen sizes and dates. Test support only; it imports nothing
// from src/testing so that it builds cleanly alongside the tools.

import { mkdir, mkdtemp, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const dayMs = 86_400_000;
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

interface FixtureFile {
  content: string | Buffer;
  ageDays: number;
}

export const fixtureFiles: Record<string, FixtureFile> = {
  "notes/plan.md": { content: "# Plan\nalpha beta\nTODO: ship search\n", ageDays: 1 },
  "notes/old-plan.md": { content: "# Old plan\nTODO: ship search\n", ageDays: 800 },
  "reports/q3-report.pdf": {
    content: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(2048)]),
    ageDays: 100,
  },
  "reports/sales.csv": { content: "region,amount\n".padEnd(300 * 1024, "x\n"), ageDays: 10 },
  "photos/cat.png": { content: pngSignature, ageDays: 30 },
  "node_modules/pkg/index.js": { content: "// TODO: ship search\n", ageDays: 1 },
  ".git/config": { content: "TODO: ship search\n", ageDays: 1 },
  "secret/keys.txt": { content: "TODO: ship search\n", ageDays: 1 },
  "deep/a/b/c/plan.txt": { content: "TODO: ship search\n", ageDays: 1 },
  "minified.js": { content: `var a=1;${"x".repeat(5000)}needle${"y".repeat(5000)}\n`, ageDays: 5 },
  "long.txt": {
    content: Array.from({ length: 500 }, (_, index) => `line ${index + 1}`).join("\n"),
    ageDays: 2,
  },
};

export interface FixtureTree {
  root: string;
  /** The folder a test's path policy should deny. */
  deniedFolder: string;
  cleanup(): Promise<void>;
}

export async function writeFixtureTree(nowMs = Date.now()): Promise<FixtureTree> {
  // realpath: /var is a symbolic link to /private/var, and the tools report real paths.
  const root = await realpath(await mkdtemp(join(tmpdir(), "vix-search-")));
  for (const [relativePath, file] of Object.entries(fixtureFiles)) {
    const path = join(root, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content);
    const time = new Date(nowMs - file.ageDays * dayMs);
    await utimes(path, time, time);
  }
  return {
    root,
    deniedFolder: join(root, "secret"),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
