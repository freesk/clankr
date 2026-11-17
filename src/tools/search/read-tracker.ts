// Which files were read in this session, and in what state (FS-1). `read_file` marks a file;
// `write_file` checks the mark before overwriting. One instance per session.

import type { FileReadState, ReadTracker } from "../../contracts/index.ts";

export class SessionReadTracker implements ReadTracker {
  private readonly states = new Map<string, FileReadState>();

  markRead(realPath: string, state: FileReadState): void {
    this.states.set(realPath, state);
  }

  readState(realPath: string): FileReadState | undefined {
    return this.states.get(realPath);
  }
}
