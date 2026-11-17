// Text the model reads when a call is refused. Each one says what would work instead,
// because a small model given a bare "denied" tends to retry the same call.

export function deniedPathMessage(realPath: string): string {
  return (
    `Refused: ${realPath} is a protected location that vix never reads or writes. ` +
    "Do not look for another way to reach it; tell the user if the task needs it."
  );
}

export function readOnlyMessage(toolName: string): string {
  return (
    `Refused: this session is read-only, so ${toolName} cannot run. ` +
    "Describe the change instead; the user can switch modes with /permissions."
  );
}

/**
 * One-shot mode has no one to ask (D14). The message names `--permission-mode` either
 * way, and says whether that flag would actually have allowed this call.
 */
export function cannotAskMessage(
  toolName: string,
  reasons: string[],
  allowedInAutoEdit: boolean,
): string {
  const why = `Refused: ${toolName} needs approval (${reasons.join("; ")}), and this run cannot ask.`;
  if (allowedInAutoEdit) {
    return `${why} The user can rerun with --permission-mode auto-edit to allow changes inside the allowed folders.`;
  }
  return (
    `${why} --permission-mode auto-edit does not cover this kind of call; ` +
    "the user must run vix interactively to approve it. Tell the user what you would do."
  );
}

export function userDeniedMessage(toolName: string, feedback: string | undefined): string {
  const trimmed = feedback?.trim();
  if (trimmed) return `The user denied ${toolName}. Their feedback: ${trimmed}`;
  return `The user denied ${toolName}. Ask what they would like instead.`;
}
