// Moving things to the macOS Trash (FS-6, D26). Injected everywhere it is used, so tests
// pass a fake and never put real files in the user's Trash.

/** Moves every path to the Trash. Must not return until they are gone from their place. */
export type TrashFunction = (paths: string[]) => Promise<void>;

/**
 * The real Trash, through the `trash` package and its bundled helper binary.
 * Loaded lazily so the package does not slow down startup.
 */
export const moveToSystemTrash: TrashFunction = async (paths) => {
  const { default: trash } = await import("trash");
  // Globbing off: a file literally named "*.txt" must not match its neighbours.
  await trash(paths, { glob: false });
};

/** What the file tools and `/undo` need from outside, so tests can replace it. */
export interface FileToolDependencies {
  trash: TrashFunction;
}

export const defaultFileToolDependencies: FileToolDependencies = { trash: moveToSystemTrash };
