// Switching the session's model (MOD-4, MOD-7, MOD-10) and announcing the change.
// Works against the LmClient contract, so it is tested with the scripted fake.

import type { Config } from "../config/index.ts";
import type {
  LmClient,
  LoadedModel,
  ModelChangedListener,
  ModelInfo,
  SessionState,
} from "../contracts/index.ts";
import { LmStudioError, modelLoadFailed, modelNotDownloaded } from "./errors.ts";
import { contextLengthFor, loadSettingsFor, planLoad, reloadNotice } from "./profiles.ts";

/** Progress text for the user: reloads, unloads, restores. */
export type Notify = (text: string) => void;

export class ModelSwitcher {
  readonly lm: LmClient;
  private readonly listeners = new Set<ModelChangedListener>();
  private readonly config: Config;

  constructor(lm: LmClient, config: Config) {
    this.lm = lm;
    this.config = config;
  }

  /** Subscribe to model changes. Returns the function that unsubscribes. */
  onModelChanged(listener: ModelChangedListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Loads the model if needed and moves the session to it. On failure the session stays on
   * the previous model, which is loaded again if it was unloaded to make room.
   */
  async switchTo(key: string, session: SessionState, notify: Notify): Promise<LoadedModel> {
    const target = await this.findDownloadedModel(key);
    const contextLength = contextLengthFor(this.config, target);
    const previous = session.model;
    if (previous?.key === key && previous.contextLength === contextLength) return previous;

    const settings = loadSettingsFor(this.config, key);
    const plan = planLoad(target, contextLength, settings);
    if (plan.action === "reload") {
      notify(reloadNotice(key, plan.instance, contextLength));
    }
    let previousUnloaded =
      plan.action === "reload" && plan.instance.instanceId === previous?.instanceId;
    if (previous && previous.key !== key && this.config.model.unloadPreviousOnSwitch) {
      notify(`Unloading ${previous.key} to free memory.`);
      await this.lm.unloadModel(previous.instanceId);
      previousUnloaded = true;
    }

    let loaded: LoadedModel;
    try {
      loaded = await this.lm.loadModel(key, { contextLength, settings });
    } catch (error) {
      if (previous && previousUnloaded) await this.restore(previous, session, notify);
      throw asLoadError(key, error);
    }
    session.model = loaded;
    await this.announce(loaded);
    return loaded;
  }

  private async findDownloadedModel(key: string): Promise<ModelInfo> {
    const models = await this.lm.listModels();
    const llms = models.filter((model) => model.type === "llm");
    const target = llms.find((model) => model.key === key);
    if (!target) {
      throw modelNotDownloaded(
        key,
        llms.map((model) => model.key),
      );
    }
    return target;
  }

  private async restore(previous: LoadedModel, session: SessionState, notify: Notify) {
    notify(`Loading ${previous.key} again so the session can continue on it.`);
    try {
      // Same key and context length, so budgets are unchanged and no announcement is needed.
      session.model = await this.lm.loadModel(previous.key, {
        contextLength: previous.contextLength,
      });
    } catch {
      session.model = undefined;
      notify(`Could not load ${previous.key} again. Pick a model with /model.`);
    }
  }

  private async announce(model: LoadedModel): Promise<void> {
    // In order, so context finishes recalculating budgets before anything else runs.
    for (const listener of this.listeners) await listener(model);
  }
}

function asLoadError(key: string, error: unknown): LmStudioError {
  if (error instanceof LmStudioError) return error;
  return modelLoadFailed(key, error instanceof Error ? error.message : String(error));
}
