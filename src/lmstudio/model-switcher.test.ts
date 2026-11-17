import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.ts";
import type { LoadedModel, ModelInfo, SlashCommandContext } from "../contracts/index.ts";
import { ScriptedLmClient, testModel } from "../testing/index.ts";
import { LmStudioClient } from "./client.ts";
import { scrubSecret } from "./errors.ts";
import {
  configForServer,
  FakeLmStudioServer,
  testSession,
} from "./fake-lm-studio-server.test-support.ts";
import { formatModelList } from "./format-models.ts";
import { createModelCommand } from "./model-command.ts";
import { ModelSwitcher } from "./model-switcher.ts";

const servers: FakeLmStudioServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

const otherModel: ModelInfo = {
  ...testModel,
  key: "test/other-4b",
  displayName: "Other 4B",
  parameterSize: "4B",
  maxContextLength: 8_192,
  capabilities: { vision: false, trainedForToolUse: true, reasoning: false },
};

/** A scripted client whose loads of one key fail, like a model too big for memory. */
class FailingLoadClient extends ScriptedLmClient {
  constructor(private readonly failingKey: string) {
    super([], [testModel, otherModel]);
  }

  override async loadModel(key: string, options: { contextLength: number }): Promise<LoadedModel> {
    if (key === this.failingKey) throw new Error("out of memory");
    return super.loadModel(key, options);
  }
}

describe("ModelSwitcher", () => {
  it("loads with the configured context length and announces the change", async () => {
    const lm = new ScriptedLmClient([], [testModel, otherModel]);
    const switcher = new ModelSwitcher(lm, defaultConfig());
    const announced: LoadedModel[] = [];
    switcher.onModelChanged((model) => {
      announced.push(model);
    });
    const session = testSession();
    await switcher.switchTo(testModel.key, session, () => {});
    expect(lm.loads).toEqual([{ key: testModel.key, contextLength: 16_384 }]);
    expect(session.model?.key).toBe(testModel.key);
    expect(announced.map((model) => model.key)).toEqual([testModel.key]);
  });

  it("uses the profile context length, capped at the model maximum (MOD-9)", async () => {
    const lm = new ScriptedLmClient([], [testModel, otherModel]);
    const config = defaultConfig();
    config.model.profiles[otherModel.key] = { contextLength: 32_768 };
    await new ModelSwitcher(lm, config).switchTo(otherModel.key, testSession(), () => {});
    expect(lm.loads).toEqual([{ key: otherModel.key, contextLength: 8_192 }]);
  });

  it("leaves the session on the previous model when the new one fails to load", async () => {
    const lm = new FailingLoadClient(otherModel.key);
    const switcher = new ModelSwitcher(lm, defaultConfig());
    const session = testSession();
    const first = await switcher.switchTo(testModel.key, session, () => {});
    await expect(switcher.switchTo(otherModel.key, session, () => {})).rejects.toMatchObject({
      kind: "model-load-failed",
    });
    expect(session.model).toBe(first);
    expect(lm.unloads).toEqual([]);
  });

  it("loads the previous model again if it was unloaded to make room (MOD-10)", async () => {
    const lm = new FailingLoadClient(otherModel.key);
    const config = defaultConfig();
    config.model.unloadPreviousOnSwitch = true;
    const switcher = new ModelSwitcher(lm, config);
    const session = testSession();
    const first = await switcher.switchTo(testModel.key, session, () => {});
    const notices: string[] = [];
    await expect(
      switcher.switchTo(otherModel.key, session, (text) => notices.push(text)),
    ).rejects.toMatchObject({ kind: "model-load-failed" });
    expect(lm.unloads).toEqual([first.instanceId]);
    expect(session.model?.key).toBe(testModel.key);
    expect(session.model?.contextLength).toBe(first.contextLength);
    expect(notices.join("\n")).toContain("again");
  });

  it("tells the user before reloading a model loaded with another context length", async () => {
    const server = new FakeLmStudioServer({
      models: [{ key: "test/a", loadedContextLengths: [4_096] }],
    });
    servers.push(server);
    const config = configForServer(await server.start());
    const client = new LmStudioClient({ config });
    const notices: string[] = [];
    const session = testSession();
    await new ModelSwitcher(client, config).switchTo("test/a", session, (t) => notices.push(t));
    expect(notices[0]).toMatch(/Reloading test\/a: .*4,096.*16,384/);
    expect(session.model?.contextLength).toBe(16_384);
    expect(server.loadedContextLengths("test/a")).toEqual([16_384]);
    await client.dispose();
  });
});

function commandContext(lm: ScriptedLmClient, choice?: string) {
  const printed: string[] = [];
  const context: SlashCommandContext = {
    session: testSession(),
    config: defaultConfig(),
    lm,
    print: (text) => printed.push(text),
    ...(choice ? { choose: async () => choice } : {}),
  };
  return { context, printed };
}

describe("/model", () => {
  it("lists language models with the MOD-3 fields", async () => {
    const embedding: ModelInfo = { ...otherModel, key: "test/embed", type: "embedding" };
    const lm = new ScriptedLmClient([], [testModel, otherModel, embedding]);
    const { context, printed } = commandContext(lm);
    await createModelCommand(new ModelSwitcher(lm, context.config)).run("", context);
    const list = printed.join("\n");
    expect(list).toContain("test/model-12b");
    expect(list).toContain("12B");
    expect(list).toContain("Q4_0");
    expect(list).toContain("max 131,072");
    expect(list).toContain("not loaded");
    expect(list).toContain("vision tools reasoning");
    expect(list).not.toContain("test/embed");
  });

  it("switches with /model <key>", async () => {
    const lm = new ScriptedLmClient([], [testModel, otherModel]);
    const { context, printed } = commandContext(lm);
    await createModelCommand(new ModelSwitcher(lm, context.config)).run(otherModel.key, context);
    expect(context.session.model?.key).toBe(otherModel.key);
    expect(printed.at(-1)).toContain("Switched to test/other-4b");
  });

  it("switches to the model picked from the list", async () => {
    const lm = new ScriptedLmClient([], [testModel, otherModel]);
    const { context } = commandContext(lm, otherModel.key);
    await createModelCommand(new ModelSwitcher(lm, context.config)).run("", context);
    expect(context.session.model?.key).toBe(otherModel.key);
  });

  it("prints the error and its fix instead of throwing", async () => {
    const lm = new ScriptedLmClient([], [testModel]);
    const { context, printed } = commandContext(lm);
    await createModelCommand(new ModelSwitcher(lm, context.config)).run("missing/model", context);
    expect(printed.join("\n")).toMatch(/not downloaded[\s\S]*Fix: /);
  });
});

describe("formatModelList", () => {
  it("marks the current model and shows loaded context lengths", () => {
    const loaded = { ...testModel, loadedInstances: [{ instanceId: "x", contextLength: 16_384 }] };
    const list = formatModelList([loaded, otherModel], testModel.key);
    expect(list.split("\n")[0]).toMatch(/^\* test\/model-12b .*loaded \(16,384\)/);
    expect(list.split("\n")[1]).toMatch(/^ {2}test\/other-4b/);
  });
});

describe("scrubSecret", () => {
  it("removes every occurrence of the token", () => {
    const text = "Malformed token provided: abc123. Token abc123 rejected.";
    expect(scrubSecret(text, "abc123")).toBe(
      "Malformed token provided: [redacted]. Token [redacted] rejected.",
    );
  });
});
