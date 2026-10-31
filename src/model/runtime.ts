export type ClaimStatus = "spawning" | "active";

export type Claim = {
  workerId: string;
  board: string;
  stageId: string;
  status: ClaimStatus;
  claimedAt: number;
  lastSeenAt: number;
  commandId?: string;
};

export type WorkerEndReason = "moved" | "released" | "force-released" | "timeout" | "spawn-failed";

export type WorkerRecord = {
  storyKey: string;
  stageId: string;
  mode: "thread" | "subagent";
  threadId?: string;
  startedAt: number;
  endedAt?: number;
  endReason?: WorkerEndReason;
};

/** `.sf/runtime/state.json` (gitignored). */
export type RuntimeState = {
  version: 1;
  claims: Record<string, Claim>;
  /** Spawns waiting for a free Worker slot, oldest first. */
  queue: { storyKey: string; board: string; stageId: string; queuedAt: number }[];
  /** Durable wake intent, retained independently of HIL and capacity. */
  dependencyWaits: Record<string, { stageId: string }>;
  failures: Record<string, { stageId: string; error: string; at: number }>;
  worktreeWarnings: Record<string, { path: string; branch: string; reason: string; at: number }>;
  workers: Record<string, WorkerRecord>;
  /** Triggers written while no server was running; run on the next start. */
  pendingTriggers: { type: "spawn" | "cleanup"; storyKey: string; stageId?: string; at: number }[];
};
