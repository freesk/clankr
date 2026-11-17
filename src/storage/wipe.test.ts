import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendPrivateFile } from "./private-files.ts";
import { openSession } from "./session.ts";
import { type WipePlan, wipe } from "./wipe.ts";

let root: string;

beforeEach(async () => {
  root = join(await mkdtemp(join(tmpdir(), "vix-wipe-")), ".vix");
});

afterEach(async () => {
  await rm(join(root, ".."), { recursive: true, force: true });
});

async function populate(): Promise<void> {
  for (const text of ["one", "two"]) {
    const session = await openSession({ root });
    await session.transcript.appendMessage({ role: "user", content: text });
    await writeFile(join(session.paths.session.results, "r1.txt"), "stored result");
    await writeFile(join(session.paths.session.snapshots, "a.txt"), "snapshot");
    await writeFile(join(session.paths.session.scratch, "spill.tmp"), "spill");
    await appendPrivateFile(session.paths.auditLog, "{}\n");
  }
  await writeFile(join(root, "config.json"), "{}");
  await writeFile(join(root, "theme.json"), "{}");
}

describe("wipe", () => {
  it("leaves only the config and theme files", async () => {
    await populate();
    const { outcome, plan } = await wipe(root, { yes: true });
    expect(outcome).toBe("deleted");
    expect(plan.sessionCount).toBe(2);
    expect(plan.sizeBytes).toBeGreaterThan(0);
    expect((await readdir(root)).sort()).toEqual(["config.json", "theme.json"]);
  });

  it("shows the plan, and deletes nothing when the answer is no", async () => {
    await populate();
    const before = await readdir(root, { recursive: true });
    let shown: WipePlan | undefined;
    const { outcome } = await wipe(root, {
      confirm: async (plan) => {
        shown = plan;
        return false;
      },
    });
    expect(outcome).toBe("declined");
    expect(shown?.sessionCount).toBe(2);
    expect(await readdir(root, { recursive: true })).toEqual(before);
  });

  it("deletes after a yes from the confirmation", async () => {
    await populate();
    const { outcome } = await wipe(root, { confirm: async () => true });
    expect(outcome).toBe("deleted");
    expect((await readdir(root)).sort()).toEqual(["config.json", "theme.json"]);
  });

  it("does not ask when there is nothing to delete", async () => {
    const { outcome } = await wipe(root, {
      confirm: async () => {
        throw new Error("should not ask");
      },
    });
    expect(outcome).toBe("nothing-to-delete");
  });
});
