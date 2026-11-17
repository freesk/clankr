// A HarnessFactory for testing the runner itself, before the real agent loop
// exists. It drives a ScriptedLmClient through a deliberately tiny loop: no
// repair, no permissions, no capping. Test code only.

import type { AgentEvent, ChatMessage, TurnInput } from "../../src/contracts/index.ts";
import { ScriptedLmClient, type ScriptedResponse } from "../../src/testing/index.ts";
import type { EvalHarness, HarnessFactory, HarnessSetup } from "../runner/harness.ts";
import { UsageRecordingLmClient } from "../runner/usage-recording-lm-client.ts";

/** A tool for the toy loop. Throwing reports the call as an error. */
export interface ToyTool {
  name: string;
  run(args: Record<string, unknown>, workingDirectory: string): Promise<string>;
}

export interface ScriptedHarnessOptions {
  /** The model's responses for one run; called once per run with the run's number (0, 1, 2...). */
  responsesForRun(runNumber: number): ScriptedResponse[];
  tools?: ToyTool[];
  /** Slash command names the harness claims to have. Only "model" does anything. */
  commands?: string[];
}

const maximumRounds = 10;

export function createScriptedHarnessFactory(options: ScriptedHarnessOptions): HarnessFactory {
  let runNumber = 0;
  return async (setup) => {
    const responses = options.responsesForRun(runNumber++);
    return new ScriptedHarness(setup, responses, options.tools ?? [], options.commands ?? []);
  };
}

class ScriptedHarness implements EvalHarness {
  private readonly lm: UsageRecordingLmClient;
  private readonly tools: ToyTool[];
  private readonly commands: string[];
  private readonly workingDirectory: string;
  private modelKey: string | undefined = "test/model-12b";

  constructor(
    setup: HarnessSetup,
    responses: ScriptedResponse[],
    tools: ToyTool[],
    commands: string[],
  ) {
    this.lm = new UsageRecordingLmClient(new ScriptedLmClient(responses));
    this.tools = tools;
    this.commands = commands;
    this.workingDirectory = setup.workingDirectory;
  }

  toolNames(): string[] {
    return this.tools.map((tool) => tool.name);
  }

  commandNames(): string[] {
    return this.commands;
  }

  activeModelKey(): string | undefined {
    return this.modelKey;
  }

  tokenTally() {
    return this.lm.tally();
  }

  async runCommand(commandLine: string): Promise<void> {
    const [name, argument] = commandLine.slice(1).split(/\s+/, 2);
    if (name === "model" && argument) this.modelKey = argument;
  }

  async close(): Promise<void> {}

  async *runTurn(input: TurnInput, signal: AbortSignal): AsyncIterable<AgentEvent> {
    const messages: ChatMessage[] = [{ role: "user", content: input }];
    for (let round = 0; round < maximumRounds; round++) {
      const calls = new Map<number, { id: string; name: string; argumentsJson: string }>();
      for await (const event of this.lm.chat({ model: "test", messages }, signal)) {
        if (event.type === "text") yield { type: "text", delta: event.delta };
        if (event.type !== "tool-call-delta") continue;
        const call = calls.get(event.index) ?? { id: "", name: "", argumentsJson: "" };
        call.id = event.id ?? call.id;
        call.name = event.name ?? call.name;
        call.argumentsJson += event.argumentsDelta ?? "";
        calls.set(event.index, call);
      }
      if (calls.size === 0) {
        yield { type: "turn-end", reason: "done" };
        return;
      }
      messages.push({ role: "assistant", content: "", toolCalls: [...calls.values()] });
      for (const call of calls.values()) {
        yield { type: "tool-start", callId: call.id, tool: call.name, keyArgument: "" };
        const outcome = await this.runToolCall(call.name, call.argumentsJson);
        yield {
          type: "tool-end",
          callId: call.id,
          resultTokens: 0,
          durationMs: 0,
          ...outcome.event,
        };
        messages.push({ role: "tool", toolCallId: call.id, content: outcome.text });
      }
    }
    yield { type: "turn-end", reason: "limit", message: "round limit" };
  }

  private async runToolCall(name: string, argumentsJson: string) {
    const tool = this.tools.find((candidate) => candidate.name === name);
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(argumentsJson);
    } catch {
      return failure("arguments are not valid JSON", "invalid");
    }
    if (!tool) return failure(`unknown tool ${name}`, "invalid");
    try {
      return {
        text: await tool.run(args, this.workingDirectory),
        event: { validity: "valid" as const },
      };
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error), "valid");
    }
  }
}

function failure(message: string, validity: "valid" | "invalid") {
  return { text: message, event: { error: message, validity } };
}
