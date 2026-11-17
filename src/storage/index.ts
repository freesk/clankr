// storage part. See specs/storage.md. Owns every byte written under `~/.clankr/`.

export {
  createEphemeralSession,
  type EphemeralSession,
  sweepEphemeralLeftovers,
} from "./ephemeral.ts";
export {
  buildClankrPaths,
  buildEphemeralClankrPaths,
  buildRootPaths,
  clankrHomeVariable,
  isValidSessionId,
  keptFileNames,
  newSessionId,
  type RootPaths,
  resolveClankrRoot,
  sessionDirectories,
} from "./layout.ts";
export {
  appendPrivateFile,
  ensurePrivateDirectories,
  ensurePrivateDirectory,
  privateDirectoryMode,
  privateFileMode,
  writePrivateFile,
} from "./private-files.ts";
export { type OpenSessionOptions, openSession, type StorageSession } from "./session.ts";
export { chooseResumeModel, FileSessionStore } from "./session-store.ts";
export { DiscardingTranscript, FileTranscript } from "./transcript.ts";
export { planWipe, type WipeConfirmation, type WipeOutcome, type WipePlan, wipe } from "./wipe.ts";
