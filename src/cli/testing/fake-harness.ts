// Fakes for the cli's own tests: a Harness whose turns are scripted, a composition around
// it, and an in-memory process environment. Test code only.

import { Readable, Writable } from "node:stream";
import { defaultConfig, loadConfig } from "../../config/index.ts";
import type {
  AgentEvent,
  ApprovalPrompter,
  Config,
  LmClient,
  SessionState,
  SlashCommand,
  TurnInputWithAttachments,
  UsageSnapshot,
  WipeReport,
} from "../../contracts/index.ts";
import { InMemoryResultStore, ScriptedLmClient } from "../../testing/index.ts";
import type { CliEnvironment, StdinMode } from "../cli-environment.ts";
import type { CliComposition, Harness, HarnessOptions } from "../harness.ts";

/** One turn's behaviour. Receives the harness so it can reach the approval prompter. */
export type FakeTurn = (
  input: TurnInputWithAttachments,
  signal: AbortSignal,
  context: { session: SessionState; approvalPrompter: ApprovalPrompter; config: Config },
) => AsyncIterable<AgentEvent>;

export interface FakeHarness extends Harness {
  readonly inputs: TurnInputWithAttachments[];
  readonly results: InMemoryResultStore;
  newSessionCount: number;
  closed: boolean;
}

export interface FakeHarnessOptions {
  turn?: FakeTurn;
  config?: Config;
  lm?: LmClient;
  slashCommands?: SlashCommand[];
  usage?: UsageSnapshot;
  approvalPrompter?: ApprovalPrompter;
  ephemeral?: boolean;
}

export function createFakeHarness(options: FakeHarnessOptions = {}): FakeHarness {
  const config = options.config ?? defaultConfig();
  const newSession = (): SessionState => ({
    id: "fake-session",
    messages: [],
    model: undefined,
    permissionMode: config.permissions.mode,
    grants: { tools: new Set(), dataFiles: new Set() },
    reasoning: "off",
    ephemeral: options.ephemeral ?? false,
  });
  let session = newSession();
  const turn = options.turn ?? textTurn("ok");
  const approvalPrompter = options.approvalPrompter ?? denyEverything;
  const harness: FakeHarness = {
    config,
    lm: options.lm ?? new ScriptedLmClient(),
    results: new InMemoryResultStore(),
    slashCommands: options.slashCommands ?? [],
    resumed: false,
    inputs: [],
    newSessionCount: 0,
    closed: false,
    session: () => session,
    runTurn(input, signal) {
      harness.inputs.push(input);
      return turn(input, signal, { session, approvalPrompter, config });
    },
    usage: () => options.usage,
    async startNewSession() {
      harness.newSessionCount += 1;
      session = newSession();
    },
    async close() {
      harness.closed = true;
    },
  };
  return harness;
}

const denyEverything: ApprovalPrompter = {
  ask: async () => ({ kind: "deny", feedback: "no prompter in this test" }),
};

export function textTurn(text: string): FakeTurn {
  return async function* () {
    yield { type: "text", delta: text };
    yield { type: "turn-end", reason: "done" };
  };
}

/** A turn that streams one word and then hangs, ignoring its signal, until the test ends. */
export function hangingTurn(): FakeTurn {
  return async function* () {
    yield { type: "text", delta: "thinking about it" };
    await new Promise(() => {});
  };
}

/**
 * Drives turns from a ScriptedLmClient, as the agent loop will: text streams through, and
 * each tool call becomes a tool-start and tool-end pair with a fixed result size.
 */
export function scriptedLmTurn(lm: ScriptedLmClient): FakeTurn {
  return async function* (input, signal) {
    while (true) {
      const request = {
        model: "test/model-12b",
        messages: [{ role: "user" as const, content: input.text }],
      };
      let calledTool = false;
      for await (const event of lm.chat(request, signal)) {
        if (event.type === "text" || event.type === "reasoning") yield event;
        if (event.type === "tool-call-delta" && event.name) {
          calledTool = true;
          const callId = event.id ?? `call_${event.index}`;
          const keyArgument = Object.values(JSON.parse(event.argumentsDelta ?? "{}"))[0];
          yield { type: "tool-start", callId, tool: event.name, keyArgument: String(keyArgument) };
          yield { type: "tool-end", callId, resultTokens: 312, durationMs: 420 };
        }
      }
      if (!calledTool) break;
    }
    yield { type: "turn-end", reason: "done" };
  };
}

export interface FakeCompositionOptions {
  harness?: (options: HarnessOptions) => FakeHarness;
  wipeReport?: WipeReport;
  configFilePath?: string;
}

export interface FakeComposition extends CliComposition {
  opened: FakeHarness[];
  openedWith: HarnessOptions[];
  wipeCount: number;
}

export function createFakeComposition(options: FakeCompositionOptions = {}): FakeComposition {
  const composition: FakeComposition = {
    opened: [],
    openedWith: [],
    wipeCount: 0,
    configFilePath: () => options.configFilePath ?? "/nonexistent/vix/config.json",
    loadConfig: ({ flags, workingDirectory, environment }) =>
      loadConfig({
        configFilePath: composition.configFilePath(),
        workingDirectory,
        environment,
        flags,
      }),
    async openHarness(harnessOptions) {
      composition.openedWith.push(harnessOptions);
      const harness = options.harness
        ? options.harness(harnessOptions)
        : createFakeHarness({
            config: harnessOptions.config,
            approvalPrompter: harnessOptions.approvalPrompter,
          });
      composition.opened.push(harness);
      return harness;
    },
    async wipe() {
      composition.wipeCount += 1;
      return options.wipeReport ?? { sessionsRemoved: 3, bytesFreed: 2_500_000 };
    },
  };
  return composition;
}

export interface TestEnvironment extends CliEnvironment {
  output(): string;
  errors(): string;
  /** Simulates Ctrl+C delivered as SIGINT, as in one-shot mode. */
  interrupt(): void;
  forcedExitCode: number | undefined;
}

export function createTestEnvironment(options: {
  argv: string[];
  composition: CliComposition;
  stdinText?: string;
  stdinMode?: StdinMode;
}): TestEnvironment {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const interruptHandlers = new Set<() => void>();
  const environment: TestEnvironment = {
    argv: options.argv,
    stdin: Readable.from([options.stdinText ?? ""]) as unknown as NodeJS.ReadStream,
    stdinMode: options.stdinMode ?? (options.stdinText === undefined ? "other" : "piped"),
    stdout: collectingStream(stdout),
    stderr: { write: (text: string) => stderr.push(text) },
    environment: {},
    workingDirectory: "/work",
    version: "1.2.3",
    composition: options.composition,
    forcedExitCode: undefined,
    onInterrupt(handler) {
      interruptHandlers.add(handler);
      return () => interruptHandlers.delete(handler);
    },
    forceExit(code) {
      environment.forcedExitCode = code;
    },
    output: () => stdout.join(""),
    errors: () => stderr.join(""),
    interrupt: () => {
      for (const handler of interruptHandlers) handler();
    },
  };
  return environment;
}

function collectingStream(chunks: string[]): NodeJS.WriteStream {
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return stream as unknown as NodeJS.WriteStream;
}
