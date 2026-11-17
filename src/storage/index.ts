// storage part. See specs/storage.md. Owns every byte written under `~/.vix/`.

export {
  createEphemeralSession,
  type EphemeralSession,
  sweepEphemeralLeftovers,
} from "./ephemeral.ts";
export {
  buildEphemeralVixPaths,
  buildRootPaths,
  buildVixPaths,
  isValidSessionId,
  keptFileNames,
  newSessionId,
  type RootPaths,
  resolveVixRoot,
  sessionDirectories,
  vixHomeVariable,
} from "./layout.ts";
export {
  appendPrivateFile,
  ensurePrivateDirectories,
  ensurePrivateDirectory,
  privateDirectoryMode,
  privateFileMode,
} from "./private-files.ts";
export { type OpenSessionOptions, openSession, type StorageSession } from "./session.ts";
export { chooseResumeModel, FileSessionStore } from "./session-store.ts";
export { DiscardingTranscript, FileTranscript } from "./transcript.ts";
export { planWipe, type WipeConfirmation, type WipeOutcome, type WipePlan, wipe } from "./wipe.ts";
