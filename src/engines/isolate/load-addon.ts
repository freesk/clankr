// The only place in clankr that loads `isolated-vm` (PRD section 12: keep the native addon behind
// one module so it can be replaced). It is loaded on first use, never at startup, because native
// addons cost startup time (specs/foundation.md, "Design notes").

import type IsolatedVm from "isolated-vm";

export type IsolatedVmModule = typeof IsolatedVm;

let loading: Promise<IsolatedVmModule> | undefined;

export function loadIsolatedVm(): Promise<IsolatedVmModule> {
  loading ??= import("isolated-vm").then((module) => module.default);
  return loading;
}
