// Semantic search end to end (SRCH-9) with every real part except the model: `clankr index`
// builds the index under CLANKR_HOME with the real path policy and DuckDB, `clankr -p` offers
// and runs `search_meaning`, and `clankr wipe` takes the index away again. The scripted model
// returns deterministic vectors, so nothing here talks to LM Studio.

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { respond } from "../../src/testing/index.ts";
import { createIntegrationKit, type IntegrationKit, lastToolResult } from "./integration-kit.ts";

let kit: IntegrationKit | undefined;

afterEach(async () => {
  await kit?.cleanup();
  kit = undefined;
});

async function writeDocuments(workingDirectory: string): Promise<void> {
  const documents = join(workingDirectory, "docs");
  await mkdir(join(documents, "contracts"), { recursive: true });
  await writeFile(
    join(documents, "contracts", "lease.md"),
    "# Lease\n\nEither party may terminate the agreement early with ninety days notice.\n",
  );
  await writeFile(join(documents, "soup.txt"), "Chop the onions and simmer the broth slowly.\n");
  // A private key file name is on the deny list wherever it lives (D43).
  await writeFile(join(documents, "id_rsa"), "terminate the agreement early, secretly\n");
}

/** Tool names offered in the request with this number, counting from 0. */
function offeredTools(testKit: IntegrationKit, requestIndex: number): string[] {
  return (testKit.lm.requests[requestIndex]?.tools ?? []).map((tool) => tool.name);
}

describe("semantic search", () => {
  it("offers search_meaning only once a folder is indexed, and finds a passage by meaning", async () => {
    kit = await createIntegrationKit({
      responses: [
        respond.text("Nothing to search yet."),
        respond.toolCall("search_meaning", { query: "ending the agreement early" }),
        respond.text("The lease covers it."),
      ],
    });
    await writeDocuments(kit.workingDirectory);

    await kit.run(["-p", "hello"]);
    expect(offeredTools(kit, 0)).not.toContain("search_meaning");

    const indexed = await kit.run(["index", "docs"]);
    // Progress goes to stderr; nothing there is an error.
    expect(indexed.stderr).toBe("Indexing: 1 of 2 files\n");
    expect(indexed.exitCode).toBe(0);
    expect(indexed.stdout).toMatch(/2 files read \(2 passages\), 0 unchanged, 0 removed\./);
    expect(indexed.stdout).toMatch(/Skipped: 1 protected\./);
    expect(await readdir(join(kit.clankrHome, "index"))).toEqual([
      expect.stringMatching(/^[0-9a-f]{16}\.duckdb$/),
    ]);

    const answered = await kit.run(["-p", "Which document talks about ending the contract early?"]);
    expect(answered.exitCode).toBe(0);
    expect(answered.stdout).toBe("The lease covers it.\n");
    expect(answered.stderr).toMatch(/search_meaning ending the agreement early/);
    expect(offeredTools(kit, 1)).toContain("search_meaning");

    const result = lastToolResult(kit.lm.requests[2]?.messages ?? []);
    const lines = result.split("\n");
    expect(lines[0]).toMatch(/^root .*docs · 2 passages, best first · indexed just now$/);
    // The kit's working folder sits behind macOS's /var link, so the path is shown in full.
    expect(lines[1]).toMatch(/docs\/contracts\/lease\.md:1-3 \(0\.\d\d\)$/);
    expect(result).not.toMatch(/id_rsa|secretly/);
  });

  it("lists and removes indexes, and updates one incrementally", async () => {
    kit = await createIntegrationKit();
    await writeDocuments(kit.workingDirectory);

    expect((await kit.run(["index"])).stdout).toMatch(/No folder is indexed/);
    await kit.run(["index", "docs"]);
    const status = await kit.run(["index", "--status"]);
    expect(status.stdout).toMatch(/docs · 2 files · 2 passages · indexed just now\n$/);

    await writeFile(join(kit.workingDirectory, "docs", "new.md"), "A new note.\n");
    const updated = await kit.run(["index", "docs"]);
    expect(updated.stdout).toMatch(/1 file read \(1 passage\), 2 unchanged, 0 removed\./);

    const removed = await kit.run(["index", "--remove", "docs"]);
    expect(removed.exitCode).toBe(0);
    expect(await readdir(join(kit.clankrHome, "index"))).toEqual([]);
    expect((await kit.run(["index", "--remove", "docs"])).exitCode).toBe(1);
  });

  it("lets an ephemeral session search without leaving anything on disk (CLI-7)", async () => {
    kit = await createIntegrationKit({
      responses: [
        respond.toolCall("search_meaning", { query: "simmer the broth" }),
        respond.text("The soup note."),
      ],
    });
    await writeDocuments(kit.workingDirectory);
    await kit.run(["index", "docs"]);
    const filesBefore = await kit.filesUnderClankrHome();

    const answered = await kit.run(["-p", "Where is the soup recipe?", "--ephemeral"]);

    expect(answered.exitCode).toBe(0);
    expect(lastToolResult(kit.lm.requests[1]?.messages ?? [])).toMatch(/docs\/soup\.txt:1 /);
    expect(await kit.filesUnderClankrHome()).toEqual(filesBefore);
  });

  it("deletes the index with `clankr wipe`, after which the tool is no longer offered", async () => {
    kit = await createIntegrationKit({ responses: [respond.text("a"), respond.text("b")] });
    await writeDocuments(kit.workingDirectory);
    await kit.run(["index", "docs"]);
    await kit.run(["-p", "hello"]);
    expect(offeredTools(kit, 0)).toContain("search_meaning");

    expect((await kit.run(["wipe", "--yes"])).exitCode).toBe(0);

    expect(await kit.filesUnderClankrHome()).toEqual(["config.json"]);
    await kit.run(["-p", "hello again"]);
    expect(offeredTools(kit, 1)).not.toContain("search_meaning");
  });

  it("refuses to index clankr's own folder", async () => {
    kit = await createIntegrationKit();
    const refused = await kit.run(["index", kit.clankrHome]);
    expect(refused.exitCode).toBe(1);
    expect(refused.stdout).toMatch(/is protected and cannot be indexed/);
  });
});
