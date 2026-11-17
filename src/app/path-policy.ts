// The real PathPolicy for a config, built the same way for a session and for `clankr index`,
// so both apply one deny list (PERM-4).

import type { Config } from "../contracts/index.ts";
import { RealPathPolicy } from "../permissions/index.ts";

export interface PathPolicyLocations {
  /** `ClankrPaths.root`: the harness's own files are denied to every tool (D42). */
  clankrRoot: string;
  workingDirectory: string;
  /** Replaces the home folder, in tests. */
  homeDirectory?: string;
}

export function createPathPolicy(config: Config, locations: PathPolicyLocations): RealPathPolicy {
  return new RealPathPolicy({
    allowedRoots: config.permissions.allowedRoots,
    extraDeniedPaths: config.permissions.extraDeniedPaths,
    clankrRoot: locations.clankrRoot,
    workingDirectory: locations.workingDirectory,
    ...(locations.homeDirectory ? { homeDirectory: locations.homeDirectory } : {}),
  });
}
