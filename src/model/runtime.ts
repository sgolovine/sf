import type { WorkerSpawnCommand } from "./commands.ts";
import type { PlacementReason } from "./placement.ts";

export type ClaimStatus = "spawning" | "active";

/** Story command authority. Independent of the external execution it was launched with. */
export type Claim = {
  workerId: string;
  board: string;
  stageId: string;
  status: ClaimStatus;
  claimedAt: number;
  lastSeenAt: number;
  commandId?: string;
  /** The launch generation this Claim belongs to. Absent only on unmigrated legacy records. */
  executionId?: string;
  machineId?: string;
};

/**
 * Why a Worker's Claim ended. It never proves the Worker's execution stopped;
 * `execution-ended` means correlated terminal evidence arrived while the Claim was live.
 */
export type WorkerEndReason = "moved" | "released" | "force-released" | "timeout" | "spawn-failed" | "execution-ended";

export type WorkerRecord = {
  storyKey: string;
  stageId: string;
  mode: "thread" | "subagent";
  threadId?: string;
  startedAt: number;
  /** When the Claim ended. Version 1 records used this for Claim end only; it never proved termination. */
  endedAt?: number;
  endReason?: WorkerEndReason;
  executionId?: string;
  machineId?: string;
};

/**
 * - `reserved`: capacity and the Story branch are held; the launch command was not delivered.
 * - `launching`: the Supervisor received the command; an external launch may exist.
 * - `running`: the Supervisor reported the launch accepted.
 * - `unknown`: the launch or its end could not be confirmed; occupancy is retained.
 * - `terminal`: correlated evidence confirmed the execution ended or never started.
 */
export type ExecutionStatus = "reserved" | "launching" | "running" | "unknown" | "terminal";
export type ExecutionOutcome = "not-started" | "completed" | "failed" | "cancelled";

/** One outstanding Supervisor request about an execution (lookup or cancellation). */
export type ExecutionAttempt = {
  id: string;
  kind: "reconcile" | "cancel";
  commandId?: string;
  requestedAt: number;
};

/** One immutable launch generation. Only nonterminal entries occupy capacity and fence the Story branch. */
export type Execution = {
  /** Launch generation and durable request identity. Never reused. */
  id: string;
  workerId: string;
  storyKey: string;
  board: string;
  stageId: string;
  machineId: string;
  /** sf identities (namespaced `sfe-`/`sfp-` locally, configured IDs remotely). */
  environmentId: string;
  projectId: string;
  /** Verified identities reported by the adapter, kept beside sf's own. */
  adapter?: { environmentId?: string; projectId?: string };
  worktree: { path: string; branch: string };
  mode: "thread" | "subagent";
  agent?: string;
  model?: string;
  commandId?: string;
  status: ExecutionStatus;
  outcome?: ExecutionOutcome;
  createdAt: number;
  dispatchedAt?: number;
  acceptedAt?: number;
  endedAt?: number;
  updatedAt: number;
  taskId?: string;
  threadId?: string;
  /** Free-form legacy launch result, e.g. an agent label. */
  label?: string;
  /** Latest evidence or the reason the state is uncertain. */
  evidence?: string;
  /** Set when reports disagreed; only authoritative reconciliation resolves it. */
  conflict?: string;
  /** What is missing before sf can confirm the end, when automatic recovery is impossible. */
  recovery?: string;
  attempt?: ExecutionAttempt;
  /** Attempts made so far and when the next automatic one may be issued. */
  attempts: number;
  nextAttemptAt?: number;
  /** The launch command until the Supervisor receives it: the publication outbox. */
  intent?: WorkerSpawnCommand;
  /** True for entries created from version 1 live Claims. */
  migrated?: boolean;
};

export type QueueWait = { at: number; reasons: (PlacementReason | { code: "branch-occupied"; executionId: string })[] };

export type QueueEntry = {
  storyKey: string;
  board: string;
  stageId: string;
  queuedAt: number;
  /** Stable FIFO tie-breaker within one `queuedAt`. */
  seq?: number;
  /** Why the last drain skipped this entry. */
  wait?: QueueWait;
};

/** `.sf/runtime/state.json` (gitignored). */
export type RuntimeState = {
  version: 2;
  /** Generated once; stable across restarts and checkout moves. */
  identity: { environmentId: string; projectId: string };
  claims: Record<string, Claim>;
  /** Spawns waiting for a Worker slot, in FIFO order (`queuedAt`, then `seq`). */
  queue: QueueEntry[];
  queueSeq: number;
  executions: Record<string, Execution>;
  /** Done cleanups waiting for the Story's execution to end. */
  deferredCleanups: Record<string, { at: number }>;
  /** Durable wake intent, retained independently of HIL and capacity. */
  dependencyWaits: Record<string, { stageId: string }>;
  failures: Record<string, { stageId: string; error: string; at: number }>;
  worktreeWarnings: Record<string, { path: string; branch: string; reason: string; at: number }>;
  workers: Record<string, WorkerRecord>;
  /** Triggers written while no server was running; run on the next start. */
  pendingTriggers: { type: "spawn" | "cleanup"; storyKey: string; stageId?: string; at: number }[];
};

export function occupies(execution: Pick<Execution, "status">) {
  return execution.status !== "terminal";
}
