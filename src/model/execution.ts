// The boundary between sf's scheduling policy and the Supervisor that runs
// Workers. sf owns capacity, the queue and Claims; the Supervisor (through an
// adapter) owns tools: launch, lookup, status and cancellation.

import type { ExecutionOutcome } from "./runtime.ts";

/**
 * Correlated execution evidence. Every identity that is present must match
 * the recorded launch generation, or the report is rejected without effect.
 */
export type ExecutionReport = {
  /** Launch generation. Filled from the command when omitted. */
  executionId?: string;
  /** Reconcile/cancel attempt the report answers; a stale attempt is ignored. */
  attemptId?: string;
  machineId?: string;
  environmentId?: string;
  projectId?: string;
  worktree?: { path?: string; branch?: string };
  /**
   * `running`: the launch was accepted (not completion). `not-started`: no
   * execution exists. `terminal`: the execution ended (`outcome`). `unknown`:
   * the state cannot be established.
   */
  status: "running" | "not-started" | "terminal" | "unknown";
  outcome?: Exclude<ExecutionOutcome, "not-started">;
  taskId?: string;
  threadId?: string;
  /** Verified adapter identities, kept beside sf's identities. */
  adapterEnvironmentId?: string;
  adapterProjectId?: string;
  /** What establishes the status. Required for `not-started` and `terminal`. */
  evidence?: string;
};

const STATUSES = ["running", "not-started", "terminal", "unknown"];
const OUTCOMES = ["completed", "failed", "cancelled"];
const TEXT_KEYS = [
  "executionId",
  "attemptId",
  "machineId",
  "environmentId",
  "projectId",
  "taskId",
  "threadId",
  "adapterEnvironmentId",
  "adapterProjectId",
  "evidence",
] as const;

/** Returns an error message, or null when `value` is a valid report. */
export function validateExecutionReport(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "execution must be an object";
  const r = value as Record<string, unknown>;
  for (const key of Object.keys(r))
    if (!(TEXT_KEYS as readonly string[]).includes(key) && !["status", "outcome", "worktree"].includes(key))
      return `execution.${key} is not supported`;
  if (!STATUSES.includes(r.status as string)) return `execution.status must be one of ${STATUSES.join(", ")}`;
  for (const key of TEXT_KEYS)
    if (r[key] !== undefined && (typeof r[key] !== "string" || !(r[key] as string).trim()))
      return `execution.${key} must be nonblank text`;
  if (r.status === "terminal" && !OUTCOMES.includes(r.outcome as string))
    return `a terminal execution needs outcome ${OUTCOMES.join(", ")}`;
  if (r.status !== "terminal" && r.outcome !== undefined) return "execution.outcome is only for terminal";
  if ((r.status === "terminal" || r.status === "not-started") && r.evidence === undefined)
    return `execution.evidence is required for ${r.status}`;
  if (r.worktree !== undefined) {
    const w = r.worktree as Record<string, unknown>;
    if (!w || typeof w !== "object" || Object.keys(w).some((k) => k !== "path" && k !== "branch"))
      return "execution.worktree must be { path?, branch? }";
    for (const k of ["path", "branch"])
      if (w[k] !== undefined && (typeof w[k] !== "string" || !(w[k] as string)))
        return `execution.worktree.${k} must be text`;
  }
  return null;
}

/** `true` when supported, otherwise the concrete reason it is not. */
export type Support = true | string;

/** What the Supervisor's adapter can do. Unsupported status never means completed. */
export type AdapterSupport = {
  name: string;
  local: Support;
  remote: Support;
  /** Look up an execution by its task/thread identity. */
  status: Support;
  /** Find a launch by its request identity after a lost response. */
  lookupByRequest: Support;
  /** Reissuing a launch with the same request identity cannot start a second execution. */
  idempotentLaunch: Support;
  cancel: Support;
};

/** Remote execution needs a verified adapter and command channel (DEV-11). */
export const REMOTE_UNSUPPORTED =
  "remote execution is unavailable: no verified remote adapter or authoritative Worker command channel (DEV-11)";

/** Adapter support derived from the Supervisor's registered capabilities. */
export function supportFor(capabilities: { app: string; canSpawnThreads: boolean; canSpawnSubagents: boolean } | null) {
  // An unregistered Supervisor keeps commands waiting, as before; a registered one must have a tool.
  const canLaunch = !capabilities || capabilities.canSpawnThreads || capabilities.canSpawnSubagents;
  const t3 = capabilities?.app === "t3-code";
  return {
    name: t3 ? "t3-code" : (capabilities?.app ?? "unregistered"),
    local: canLaunch ? true : "the Supervisor reports no thread or subagent tool",
    remote: REMOTE_UNSUPPORTED,
    status: t3
      ? true
      : "status comes only from the Supervisor's own observation of its Workers; no lookup tool is declared",
    lookupByRequest: t3
      ? "launch lookup by request identity is not declared by the installed T3 tools"
      : "the Supervisor cannot look up launches by request identity",
    idempotentLaunch: "durable launch deduplication is unverified; a lost launch is never reissued",
    cancel: t3 ? true : "cancellation depends on the Supervisor's tools; acknowledgement is not termination",
  } satisfies AdapterSupport;
}
