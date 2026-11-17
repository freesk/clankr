// The one test that uses the real macOS Trash. Opt-in, because it puts a file in the
// user's Trash: run with VIX_TEST_REAL_TRASH=1. It only ever trashes a fresh temporary file.

import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pathExists } from "./disk.ts";
import { moveToSystemTrash } from "./trash.ts";

describe.skipIf(process.env.VIX_TEST_REAL_TRASH !== "1")("moveToSystemTrash", () => {
  it("moves a temporary file to the macOS Trash", async () => {
    const folder = await mkdtemp(join(tmpdir(), "vix-real-trash-"));
    const name = `vix-trash-test-${Date.now()}.txt`;
    const file = join(folder, name);
    await writeFile(file, "safe to delete: created by the vix test suite\n");
    try {
      await moveToSystemTrash([file]);
      expect(await pathExists(file)).toBe(false);
      // Listing ~/.Trash needs Full Disk Access for the terminal; skip the check without it.
      const trashListing = await readdir(join(homedir(), ".Trash")).catch(() => undefined);
      if (trashListing)
        expect(trashListing.some((entry) => entry.startsWith("vix-trash-test-"))).toBe(true);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
