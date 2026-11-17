// The REPL's status line (CLI-8) against the real harness: the token count follows the usage
// LM Studio reports after every model call, during a turn and after it.

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Harness } from "../../src/cli/harness.ts";
import { ReplController } from "../../src/cli/repl/controller.ts";
import { ReplApprovalPrompter } from "../../src/cli/repl/repl-approval-prompter.ts";
import type { ChatEvent } from "../../src/contracts/index.ts";
import { respond } from "../../src/testing/index.ts";
import { createIntegrationKit, type IntegrationKit } from "./integration-kit.ts";

let kit: IntegrationKit | undefined;
let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  await kit?.cleanup();
  harness = undefined;
  kit = undefined;
});

/** A scripted reply whose usage event reports `promptTokens`, as LM Studio does. */
function withUsage(events: ChatEvent[], promptTokens: number): ChatEvent[] {
  return events.map((event) =>
    event.type === "usage"
      ? { type: "usage", usage: { promptTokens, completionTokens: 20 } }
      : event,
  );
}

async function openRepl(current: IntegrationKit) {
  const config = await current.composition.loadConfig({
    flags: {},
    workingDirectory: current.workingDirectory,
    environment: {},
  });
  const prompter = new ReplApprovalPrompter();
  const opened = await current.composition.openHarness({
    config,
    approvalPrompter: prompter,
    ephemeral: true,
    resume: false,
    workingDirectory: current.workingDirectory,
  });
  const controller = new ReplController({
    harness: opened,
    workingDirectory: current.workingDirectory,
  });
  prompter.connect(controller);
  return { opened, controller };
}

describe("REPL status line", () => {
  it("shows the reported token count after every model call, within and across turns", async () => {
    kit = await createIntegrationKit({
      responses: [
        withUsage(respond.toolCall("read_file", { path: "notes.txt" }), 3_100),
        withUsage(respond.text("Milk and eggs."), 3_400),
        withUsage(respond.text("Nothing else."), 5_200),
      ],
    });
    await writeFile(join(kit.workingDirectory, "notes.txt"), "milk\neggs\n");
    const { opened, controller } = await openRepl(kit);
    harness = opened;
    const seen = new Set<string>();
    controller.subscribe(() => seen.add(controller.getState().statusLine));

    await controller.submit("What is in my notes?");
    // The first call's count is shown while the turn is still running (before the second call).
    expect([...seen].some((line) => line.includes("3,100 /"))).toBe(true);
    expect(controller.getState().statusLine).toContain("3,400 /");

    await controller.submit("Anything else?");
    expect(controller.getState().statusLine).toContain("5,200 /");
  });
});
