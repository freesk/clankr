// Builds the real Harness the cli runs: one LM Studio connection, one model switcher, one
// chart renderer, and one tool inventory for the process, plus a SessionRuntime per session
// (replaced by `/clear`). The cli loads this module lazily, so `--help` and `wipe` never pay
// for it.

import { type AgentDependencies, runTurn as runAgentTurn, thinkCommand } from "../agent/index.ts";
import type { Harness, HarnessOptions } from "../cli/harness.ts";
import type {
  AgentEvent,
  LoadedModel,
  PermissionGate,
  SessionState,
  ToolContext,
  TurnInputWithAttachments,
} from "../contracts/index.ts";
import { createChartRenderer } from "../engines/browser/index.ts";
import { createModelCommand, ModelSwitcher } from "../lmstudio/index.ts";
import { createPickerFormatPrompter, formatCommand } from "../output/index.ts";
import { permissionsCommand } from "../permissions/index.ts";
import { searchToolGroups } from "../semantic/index.ts";
import type { FileToolDependencies } from "../tools/fs/index.ts";
import {
  type ActiveSession,
  chooseStartingModel,
  findSessionToResume,
  initialSessionState,
  openActiveSession,
} from "./active-session.ts";
import type { LmConnection } from "./lm-connection.ts";
import { NestedEventQueue } from "./nested-events.ts";
import { outputFormatContextFor } from "./output-format.ts";
import { sessionCommandsFor } from "./session-commands.ts";
import { reasoningFor, toolCallingWarning } from "./session-state.ts";
import { buildToolSet } from "./tool-set.ts";

export interface HarnessSeams {
  /** From storage's `resolveClankrRoot`. */
  root: string;
  connection: LmConnection;
  fileTools: FileToolDependencies;
  /** Replaces the home folder for the path policy, in tests. */
  homeDirectory?: string;
}

export async function openHarness(options: HarnessOptions, seams: HarnessSeams): Promise<Harness> {
  const { config } = options;
  const notify = options.notify ?? (() => {});
  const lm = seams.connection.lm;
  const sessionOptions = { options, seams };

  // Connect before opening storage, so a start that fails (LM Studio not running) writes nothing.
  const saved = options.resume ? await findSessionToResume(seams.root) : undefined;
  const firstState = initialSessionState(options, saved);
  let opened: ActiveSession | undefined;
  const switcher = new ModelSwitcher(lm, config);
  switcher.onModelChanged(async (model: LoadedModel) => {
    const state = opened?.state ?? firstState;
    state.reasoning = reasoningFor(model, config);
    // Before storage opens there is no engine yet; it is built with the loaded model.
    await opened?.runtime.context.onModelChanged(model);
    const warning = toolCallingWarning(model, config);
    if (warning) notify(warning);
  });

  try {
    const modelKey = await chooseStartingModel(lm, config, saved?.modelKey, notify);
    await seams.connection.connect({ switcher, session: firstState, modelKey, notify });
    opened = await openActiveSession(sessionOptions, firstState, saved);
  } catch (error) {
    await seams.connection.dispose().catch(() => undefined);
    throw error;
  }
  let active: ActiveSession = opened;

  const renderer = createChartRenderer({
    idleMilliseconds: config.data.browserIdleSeconds * 1000,
    // DATA-14: every blocked browser request goes to the audit log.
    logBlocked: (request) => {
      void active.runtime.audit.record({
        tool: "browser",
        arguments: { url: request.url, method: request.method, type: request.resourceType },
        decision: "denied",
        outcome: "not-run",
      });
    },
  });
  const nested = new NestedEventQueue();
  // The gate belongs to the session; tools built once for the process reach it through this.
  const currentGate: PermissionGate = {
    check: (tool, args, preview) => active.runtime.permissions.check(tool, args, preview),
  };
  const toolSet = buildToolSet({
    config,
    renderer,
    fileTools: seams.fileTools,
    currentModel: () => active.state.model,
    permissions: currentGate,
    onSubAgentEvent: (event) => nested.push(event),
    currentAudit: () => active.runtime.audit,
  });

  // D85: only the REPL lends a picker; without one, a tool that needs a format cannot ask.
  const formatPrompter = options.choose ? createPickerFormatPrompter(options.choose) : undefined;

  function createToolContext(signal: AbortSignal): ToolContext {
    const { runtime, state } = active;
    const context: ToolContext = {
      signal,
      results: runtime.results,
      paths: runtime.pathPolicy,
      dataSources: runtime.dataSources,
      readTracker: runtime.readTracker,
      lm,
      clankrPaths: runtime.paths,
      config,
      workingDirectory: options.workingDirectory,
      reasoning: state.reasoning,
      outputFormat: outputFormatContextFor(state, formatPrompter, signal),
    };
    if (state.model) context.model = state.model;
    return context;
  }

  function agentDependencies(): AgentDependencies {
    const { runtime } = active;
    return {
      lm,
      context: runtime.context,
      permissions: runtime.permissions,
      tools: toolSet.tools,
      createToolContext,
      config,
      workingDirectory: options.workingDirectory,
      toolReferences: toolSet.toolReferences,
      audit: runtime.audit,
      // D90: `search_meaning` is offered only while a search index exists.
      availableToolGroups: () => searchToolGroups(runtime.paths.indexDirectory),
    };
  }

  async function* runTurn(
    input: TurnInputWithAttachments,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const turnSession = active;
    const events = runAgentTurn(agentDependencies(), turnSession.state, input, signal);
    try {
      for await (const event of nested.merge(events)) {
        yield event;
        // Saved as the turn goes, so a crash loses at most the call that was running.
        if (event.type === "tool-end" || event.type === "turn-end") await turnSession.save();
      }
    } finally {
      await turnSession.save();
    }
  }

  return {
    config,
    lm,
    get results() {
      return active.runtime.results;
    },
    slashCommands: [
      createModelCommand(switcher),
      permissionsCommand,
      thinkCommand,
      formatCommand,
      ...sessionCommandsFor(active.runtime.slashCommands, () => active),
    ],
    resumed: options.resume,
    session: (): SessionState => active.state,
    runTurn,
    usage: () => (active.state.model ? active.runtime.context.usage() : undefined),
    async startNewSession() {
      const previous = active;
      await previous.close();
      active = await openActiveSession(
        sessionOptions,
        initialSessionState(options, undefined, previous.state),
      );
      opened = active;
    },
    async close() {
      await settleAll([
        () => active.close(),
        () => renderer.close(),
        () => seams.connection.dispose(),
      ]);
    },
  };
}

/** Runs every cleanup step even when one fails, then reports the first failure. */
async function settleAll(steps: (() => Promise<void>)[]): Promise<void> {
  const outcomes = [];
  for (const step of steps)
    outcomes.push(
      await step().then(
        () => undefined,
        (error) => error,
      ),
    );
  const failure = outcomes.find((outcome) => outcome !== undefined);
  if (failure) throw failure;
}
