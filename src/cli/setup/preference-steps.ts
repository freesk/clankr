// Setup steps 4 to 6: context length, permission mode, and allowed folders.

import { isAbsolute, join, resolve } from "node:path";
import type { ModelInfo, PermissionMode } from "../../contracts/index.ts";
import { formatCount } from "../../lmstudio/index.ts";
import { askOrCancel, withDefault } from "./prompter.ts";
import type { SetupContext } from "./setup-context.ts";

export async function askContextLength(
  context: SetupContext,
  current: number,
  model: ModelInfo | undefined,
): Promise<number> {
  const { prompter } = context;
  while (true) {
    const answer = await askOrCancel(prompter, withDefault("Context length", formatCount(current)));
    const length = answer === "" ? current : parseCount(answer);
    if (length === undefined) {
      prompter.print("Type a whole number of tokens, for example 16384.");
      continue;
    }
    return capAtModelMaximum(context, length, model);
  }
}

/** Accepts "16384", "16,384", and "16_384". */
function parseCount(text: string): number | undefined {
  const digits = text.replace(/[,_\s]/g, "");
  if (!/^\d+$/.test(digits)) return undefined;
  const value = Number(digits);
  return value > 0 && Number.isSafeInteger(value) ? value : undefined;
}

// D47: a length above the model's maximum would fail to load.
function capAtModelMaximum(context: SetupContext, length: number, model: ModelInfo | undefined) {
  const maximum = model?.maxContextLength ?? 0;
  if (maximum <= 0 || length <= maximum) return length;
  context.prompter.print(
    `${model?.key} supports at most ${formatCount(maximum)} tokens; using ${formatCount(maximum)}.`,
  );
  return maximum;
}

const permissionModes: { mode: PermissionMode; explanation: string }[] = [
  { mode: "ask", explanation: "asks before every change to a file (the safe default)" },
  { mode: "auto-edit", explanation: "changes files inside the allowed folders without asking" },
  { mode: "read-only", explanation: "never changes files" },
];

export async function askPermissionMode(
  context: SetupContext,
  current: PermissionMode,
): Promise<PermissionMode> {
  const { prompter } = context;
  const width = Math.max(...permissionModes.map((entry) => entry.mode.length));
  prompter.print(
    permissionModes
      .map((entry, index) => `${index + 1}. ${entry.mode.padEnd(width)}  ${entry.explanation}`)
      .join("\n"),
  );
  while (true) {
    const answer = (
      await askOrCancel(prompter, withDefault("Permission mode (number or name)", current))
    ).toLowerCase();
    if (answer === "") return current;
    const picked =
      permissionModes.find((entry) => entry.mode === answer) ?? permissionModes[Number(answer) - 1];
    if (picked) return picked.mode;
    prompter.print("Pick 1, 2, or 3, or type ask, auto-edit, or read-only.");
  }
}

const startFolderLabel = "the folder clankr is started in";
const clearWord = "-";

export function describeAllowedRoots(roots: string[]): string {
  return roots.length === 0 ? startFolderLabel : roots.join(", ");
}

/** PERM-3. Folders are saved as absolute paths, so they mean the same from any start folder. */
export async function askAllowedRoots(context: SetupContext, current: string[]): Promise<string[]> {
  context.prompter.print(
    `Allowed folders are where clankr may change files. Comma-separated; "${clearWord}" means ${startFolderLabel}.`,
  );
  const answer = await askOrCancel(
    context.prompter,
    withDefault("Allowed folders", describeAllowedRoots(current)),
  );
  if (answer === "") return current;
  if (answer === clearWord) return [];
  return answer
    .split(",")
    .map((folder) => folder.trim())
    .filter((folder) => folder !== "")
    .map((folder) => absoluteFolder(folder, context));
}

function absoluteFolder(folder: string, context: SetupContext): string {
  if (folder === "~") return context.homeDirectory;
  if (folder.startsWith("~/")) return join(context.homeDirectory, folder.slice(2));
  return isAbsolute(folder) ? folder : resolve(context.workingDirectory, folder);
}
