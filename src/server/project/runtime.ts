import crypto from "node:crypto";
import type { Execution, QueueEntry, RuntimeState, WorkerRecord } from "#model/runtime";
import { readJson, writeJson } from "./fsutil.ts";
import { sfPaths } from "./paths.ts";
import { storyBranch, worktreePath } from "./worktree.ts";

export const RUNTIME_VERSION = 2;

export function newIdentity(): RuntimeState["identity"] {
  return {
    environmentId: `sfe-${crypto.randomBytes(8).toString("hex")}`,
    projectId: `sfp-${crypto.randomBytes(8).toString("hex")}`,
  };
}

export function emptyRuntime(): RuntimeState {
  return {
    version: 2,
    identity: newIdentity(),
    claims: {},
    queue: [],
    queueSeq: 0,
    executions: {},
    deferredCleanups: {},
    dependencyWaits: {},
    failures: {},
    worktreeWarnings: {},
    workers: {},
    pendingTriggers: [],
  };
}

/** Loads and, when needed, migrates the runtime. Fields this version does not know are kept. */
export function loadRuntime(root: string): RuntimeState {
  const raw = readJson<Partial<RuntimeState> & { version?: number }>(sfPaths(root).stateJson);
  if (!raw) return emptyRuntime();
  return migrateRuntime(root, raw);
}

export function saveRuntime(root: string, state: RuntimeState) {
  writeJson(sfPaths(root).stateJson, state);
}

/**
 * Version 1 → 2. Repeatable: identities derive from the persisted Worker id, so
 * an unsaved read and a later saved migration agree. Every live Claim becomes an
 * occupying local execution; a version 1 `endedAt` only recorded Claim end and
 * cannot prove an execution stopped, but without a live Claim or an unresolved
 * spawn it stays history. Missing external identities become `unknown`.
 */
export function migrateRuntime(root: string, raw: Partial<RuntimeState> & { version?: number }): RuntimeState {
  const rt = { ...emptyRuntime(), ...raw } as RuntimeState;
  if (raw.version === RUNTIME_VERSION && raw.identity) return rt;
  rt.identity = raw.identity ?? {
    // Stable across unsaved reads; regenerated identities are never needed for history.
    environmentId: `sfe-${hash(`env:${root}:${firstClaimAt(raw)}`)}`,
    projectId: `sfp-${hash(`project:${root}:${firstClaimAt(raw)}`)}`,
  };
  rt.executions = { ...raw.executions };
  rt.queue = (raw.queue ?? []).map((q: QueueEntry, i) => ({ ...q, seq: q.seq ?? i }));
  rt.queueSeq = Math.max(raw.queueSeq ?? 0, rt.queue.length);
  rt.workers = { ...raw.workers };
  for (const [key, claim] of Object.entries(rt.claims)) {
    if (claim.executionId && rt.executions[claim.executionId]) continue;
    const id = `x-m${hash(`${claim.workerId}`)}`;
    const worker: WorkerRecord | undefined = rt.workers[claim.workerId];
    const t = claim.claimedAt;
    const known = worker?.threadId;
    const execution: Execution = {
      id,
      workerId: claim.workerId,
      storyKey: key,
      board: claim.board,
      stageId: claim.stageId,
      machineId: "local",
      environmentId: rt.identity.environmentId,
      projectId: rt.identity.projectId,
      worktree: { path: worktreePath(root, key), branch: storyBranch(key) },
      mode: worker?.mode ?? "subagent",
      ...(claim.commandId ? { commandId: claim.commandId } : {}),
      // A spawning Claim's command may still be undelivered; startup recovery checks it.
      status: claim.status === "spawning" ? "launching" : known ? "running" : "unknown",
      createdAt: t,
      updatedAt: t,
      ...(known ? { label: known } : {}),
      evidence:
        claim.status === "spawning"
          ? "migrated from a version 1 spawning Claim; its command is checked before anything is delivered"
          : known
            ? "migrated from a version 1 active Claim"
            : "migrated from a version 1 active Claim without an external identity",
      attempts: 0,
      migrated: true,
    };
    rt.executions[id] = execution;
    claim.executionId = id;
    claim.machineId = "local";
    if (worker) Object.assign(worker, { executionId: id, machineId: "local" });
  }
  rt.version = 2;
  return rt;
}

function firstClaimAt(raw: Partial<RuntimeState>) {
  return Object.values(raw.claims ?? {})
    .map((c) => c.claimedAt)
    .sort()
    .join(",");
}

function hash(text: string) {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}
