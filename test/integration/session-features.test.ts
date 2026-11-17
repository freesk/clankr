// Session features that span parts: `delegate` with nested tool lines, `/compact` written
// back to the transcript, and `/clear` starting a fresh session.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Harness } from "../../src/cli/harness.ts";
import type { AgentEvent, SlashCommandContext } from "../../src/contracts/index.ts";
import { FileSessionStore } from "../../src/storage/index.ts";
import { QueuedApprovalPrompter, respond } from "../../src/testing/index.ts";
import { createIntegrationKit, type IntegrationKit } from "./integration-kit.ts";

let kit: IntegrationKit | undefined;
let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  await kit?.cleanup();
  harness = undefined;
  kit = undefined;
});

async function openHarness(current: IntegrationKit): Promise<Harness> {
  const config = await current.composition.loadConfig({
    flags: {},
    workingDirectory: current.workingDirectory,
    environment: {},
  });
  return current.composition.openHarness({
    config,
    approvalPrompter: new QueuedApprovalPrompter(),
    ephemeral: false,
    resume: false,
    workingDirectory: current.workingDirectory,
  });
}

async function runTurn(target: Harness, text: string): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of target.runTurn({ text }, new AbortController().signal)) {
    events.push(event);
  }
  return events;
}

async function runCommand(target: Harness, name: string): Promise<string[]> {
  const printed: string[] = [];
  const context: SlashCommandContext = {
    session: target.session(),
    config: target.config,
    lm: target.lm,
    print: (text) => printed.push(text),
  };
  const command = target.slashCommands.find((candidate) => candidate.name === name);
  await command?.run("", context);
  return printed;
}

describe("session features", () => {
  it("shows a sub-agent's calls as nested tool lines and keeps only its summary", async () => {
    kit = await createIntegrationKit({
      responses: [
        respond.toolCall("delegate", { brief: "Read notes.txt and say what it lists." }),
        respond.toolCall("read_file", { path: "notes.txt" }, "call_1"),
        respond.text("It lists milk and eggs."),
        respond.text("Your notes list milk and eggs."),
      ],
    });
    await writeFile(join(kit.workingDirectory, "notes.txt"), "milk\neggs\n");
    harness = await openHarness(kit);

    const events = await runTurn(harness, "What is in my notes?");

    const starts = events.flatMap((event) => (event.type === "tool-start" ? [event] : []));
    expect(starts.map((event) => event.tool)).toEqual(["delegate", "delegate › read_file"]);
    // The nested call keeps an id of its own even though the sub-agent reused "call_1".
    expect(new Set(starts.map((event) => event.callId)).size).toBe(2);
    expect(events.at(-1)).toEqual({ type: "turn-end", reason: "done" });
    const history = JSON.stringify(harness.session().messages);
    expect(history).toContain("It lists milk and eggs.");
    expect(history).not.toContain("1\\tmilk");
    // PERM-8 covers the sub-agent's calls too; the log is written as each call ends.
    await harness.close();
    harness = undefined;
    const audit = await readFile(join(kit.clankrHome, "logs", "audit.jsonl"), "utf8");
    const tools = audit
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).tool);
    expect(tools).toEqual(["read_file", "delegate"]);
  });

  it("writes /compact back to the transcript, and /clear starts an empty session", async () => {
    kit = await createIntegrationKit({
      responses: [
        respond.text("First."),
        respond.text("Second."),
        respond.text("Goal: test\nFacts found:\n- none\nFiles touched:\nOpen steps:\n- none"),
      ],
    });
    harness = await openHarness(kit);
    await runTurn(harness, "one");
    await runTurn(harness, "two");
    const firstId = harness.session().id;

    const printed = await runCommand(harness, "compact");
    expect(printed.join("\n")).toMatch(/Compacted/);
    const compacted = harness.session().messages;
    const saved = await new FileSessionStore(kit.clankrHome).load(firstId);
    expect(saved.messages).toEqual(compacted);

    // `/clear` is the cli's own command; what it calls on the harness is startNewSession.
    await harness.startNewSession();
    expect(harness.session().id).not.toBe(firstId);
    expect(harness.session().messages).toEqual([]);
    expect(harness.session().model?.key).toBe(saved.modelKey);
  });
});
