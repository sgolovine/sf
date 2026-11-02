import type { ExecutionView } from "#model/api";
import type { ProjectConfig } from "#model/config";
import type { Execution } from "#model/runtime";

/** Task/thread IDs the Supervisor reported, as plain text; sf builds no links for them. */
export function reportedIds(e: Pick<Execution, "taskId" | "threadId">) {
  return [e.taskId && `task ${e.taskId}`, e.threadId && `thread ${e.threadId}`].filter(Boolean).join(", ");
}

/** The ledger as shown: occupying entries only unless terminal history is requested; server order is kept. */
export function shownExecutions<T extends Pick<ExecutionView, "occupying">>(executions: T[], showTerminal: boolean) {
  return showTerminal ? executions : executions.filter((e) => e.occupying);
}

/**
 * How sure sf is about an entry. `unconfirmed`: it still occupies a slot but no Worker holds the
 * Claim, whatever its status. `unknown`: the launch or end could not be confirmed.
 */
export type Occupancy = "active" | "pending" | "unconfirmed" | "unknown" | "ended";

export function occupancy(e: Pick<ExecutionView, "status" | "occupying" | "claimLive">): Occupancy {
  if (!e.occupying) return "ended";
  if (e.status === "unknown") return "unknown";
  if (!e.claimLive) return "unconfirmed";
  return e.status === "running" ? "active" : "pending";
}

export const OCCUPANCY_LABEL: Record<Occupancy, string> = {
  active: "Claim active",
  pending: "Claim active · launch pending",
  unconfirmed: "Claim ended · awaiting end evidence",
  unknown: "Unknown · awaiting evidence",
  ended: "Ended",
};

/** Why Reconcile/Cancel cannot be requested for this entry, or undefined when they can. */
export function recoveryBlocked(e: Pick<ExecutionView, "status" | "occupying">) {
  if (!e.occupying) return "This execution has ended.";
  if (e.status === "reserved") return "The launch has not been delivered to the Supervisor yet.";
  return undefined;
}

/** Capacity as text; a machine sf has no limit for is unknown, never zero. */
export function capacityText(capacity: number | null) {
  return capacity === null ? "unknown" : String(capacity);
}

/** A configured remote's name with its ID; anything else (local, removed machines) by ID. */
export function machineName(project: Pick<ProjectConfig, "scheduling">, machineId: string) {
  const remote = project.scheduling?.remotes.find((r) => r.id === machineId);
  return remote ? `${remote.name} (${remote.id})` : machineId;
}
