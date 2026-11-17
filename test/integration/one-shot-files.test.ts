// `clankr -p` end to end with every real part except the model: storage, config, context,
// permissions, the agent loop, and the search and file tools (M1 scenarios in miniature).

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileSessionStore } from "../../src/storage/index.ts";
import { respond, testModel } from "../../src/testing/index.ts";
import { createIntegrationKit, type IntegrationKit } from "./integration-kit.ts";

let kit: IntegrationKit | undefined;

afterEach(async () => {
  await kit?.cleanup();
  kit = undefined;
});

describe("one-shot file turn", () => {
  it("finds, reads, and writes files, then saves the transcript and the audit log", async () => {
    kit = await createIntegrationKit({
      responses: [
        respond.toolCall("find_files", { pattern: "*.txt", root: "." }),
        respond.toolCall("read_file", { path: "notes.txt" }),
        respond.toolCall("write_file", { path: "summary.txt", content: "Two items.\n" }),
        respond.text("Wrote summary.txt."),
      ],
    });
    await writeFile(join(kit.workingDirectory, "notes.txt"), "milk\neggs\n");

    const result = await kit.run([
      "-p",
      "Summarize my notes into summary.txt",
      "--permission-mode",
      "auto-edit",
    ]);

    expect(result.stderr).not.toMatch(/clankr: /);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Wrote summary.txt.\n");
    expect(result.stderr).toMatch(/find_files \*\.txt/);
    expect(await readFile(join(kit.workingDirectory, "summary.txt"), "utf8")).toBe("Two items.\n");

    // find_files saw the file; read_file returned its lines.
    const requests = kit.lm.requests;
    expect(JSON.stringify(requests[1]?.messages)).toContain("notes.txt");
    expect(JSON.stringify(requests[2]?.messages)).toContain("eggs");
    // ChatRequest.model is the loaded instance, not the key.
    expect(requests[0]?.model).toBe(`${testModel.key}:1`);

    const saved = await new FileSessionStore(kit.clankrHome).newest();
    expect(saved?.modelKey).toBe(testModel.key);
    expect(saved?.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
      "tool",
      "assistant",
      "tool",
      "assistant",
    ]);
    const transcript = await readFile(
      join(kit.clankrHome, "sessions", saved?.id ?? "", "transcript.jsonl"),
      "utf8",
    );
    // A turn that never compacted only appends.
    expect(transcript).not.toContain('"type":"history"');

    const audit = (await readFile(join(kit.clankrHome, "logs", "audit.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(audit.map((entry) => [entry.tool, entry.decision, entry.outcome])).toEqual([
      ["find_files", "allowed", "ok"],
      ["read_file", "allowed", "ok"],
      ["write_file", "allowed", "ok"],
    ]);
    expect(audit[2].basis).toBe("mode");
  });

  it("denies a write in one-shot ask mode and names --permission-mode", async () => {
    kit = await createIntegrationKit({
      responses: [
        respond.toolCall("write_file", { path: "out.txt", content: "hello\n" }),
        respond.text("I could not write the file."),
      ],
    });

    const result = await kit.run(["-p", "Write hello to out.txt"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--permission-mode");
    await expect(readFile(join(kit.workingDirectory, "out.txt"))).rejects.toThrow();
    const toolMessage = kit.lm.requests[1]?.messages.findLast((m) => m.role === "tool");
    expect(toolMessage?.content).toContain("--permission-mode");
  });

  it("leaves nothing on disk after an ephemeral run", async () => {
    kit = await createIntegrationKit({
      responses: [respond.toolCall("read_file", { path: "notes.txt" }), respond.text("Done.")],
    });
    await writeFile(join(kit.workingDirectory, "notes.txt"), "secret cell values\n");

    const result = await kit.run(["-p", "Read notes.txt", "--ephemeral"]);

    expect(result.exitCode).toBe(0);
    expect(await kit.filesUnderClankrHome()).toEqual(["config.json"]);
  });

  it("resumes the most recent session with its history", async () => {
    kit = await createIntegrationKit({
      responses: [respond.text("First answer."), respond.text("Second answer.")],
    });
    expect((await kit.run(["-p", "Remember the word heliotrope"])).exitCode).toBe(0);

    const result = await kit.run(["-p", "Which word?", "--resume"]);

    expect(result.exitCode).toBe(0);
    const resumedRequest = JSON.stringify(kit.lm.requests[1]?.messages);
    expect(resumedRequest).toContain("heliotrope");
    expect(resumedRequest).toContain("First answer.");
  });
});
