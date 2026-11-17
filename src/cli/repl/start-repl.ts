// Starts the interactive REPL (CLI-1). run-cli.ts imports this module with `await import()`,
// and this module imports the Ink view the same way, so Ink loads only for the REPL.

import type { Config } from "../../contracts/index.ts";
import type { SessionCommand } from "../arguments.ts";
import type { CliEnvironment } from "../cli-environment.ts";
import { type ExitCode, exitCodes } from "../exit-codes.ts";
import type { Harness } from "../harness.ts";
import { createIndexSlashCommand } from "../index-command.ts";
import { errorMessage, redactSecrets } from "../secrets.ts";
import { createConfigCommand, offerSetupAfterFailedStart } from "../setup/config-command.ts";
import { ReplController } from "./controller.ts";
import { ReplApprovalPrompter } from "./repl-approval-prompter.ts";

export interface StartReplRequest {
  command: SessionCommand;
  config: Config;
  environment: CliEnvironment;
}

export async function startRepl(request: StartReplRequest): Promise<ExitCode> {
  const { command, config, environment } = request;
  const prompter = new ReplApprovalPrompter();
  // Notices from opening the harness arrive before the REPL exists; they are shown once it does.
  const earlyNotices: string[] = [];
  let showNotice = (text: string) => {
    earlyNotices.push(text);
  };
  let harness: Harness;
  try {
    harness = await environment.composition.openHarness({
      config,
      approvalPrompter: prompter,
      ephemeral: command.ephemeral,
      resume: command.resume,
      workingDirectory: environment.workingDirectory,
      notify: (text) => showNotice(text),
    });
  } catch (error) {
    environment.stderr.write(`clankr: ${redactSecrets(errorMessage(error), config)}\n`);
    await offerSetupAfterFailedStart(environment, config);
    return exitCodes.failed;
  }

  const controller = new ReplController({
    harness,
    workingDirectory: environment.workingDirectory,
    cliCommands: [
      createConfigCommand({
        configFilePath: environment.composition.configFilePath(),
        environment: environment.environment,
        workingDirectory: environment.workingDirectory,
      }),
      createIndexSlashCommand({
        composition: environment.composition,
        workingDirectory: environment.workingDirectory,
        ephemeral: command.ephemeral,
      }),
    ],
  });
  prompter.connect(controller);
  showNotice = (text) => controller.showNotice(text);
  for (const notice of earlyNotices) controller.showNotice(notice);
  const { mountReplView } = await import("./view.ts");
  const instance = mountReplView(controller, environment);
  try {
    await controller.whenExited();
  } finally {
    instance.unmount();
    await instance.waitUntilExit().catch(() => {});
    await harness.close();
  }
  return exitCodes.done;
}
