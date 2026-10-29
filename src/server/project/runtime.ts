import type { RuntimeState } from "#model/runtime";
import { readJson, writeJson } from "./fsutil.ts";
import { sfPaths } from "./paths.ts";

export function emptyRuntime(): RuntimeState {
  return { version: 1, claims: {}, queue: [], failures: {}, worktreeWarnings: {}, workers: {}, pendingTriggers: [] };
}

export function loadRuntime(root: string): RuntimeState {
  return { ...emptyRuntime(), ...readJson<Partial<RuntimeState>>(sfPaths(root).stateJson), version: 1 };
}

export function saveRuntime(root: string, state: RuntimeState) {
  writeJson(sfPaths(root).stateJson, state);
}
