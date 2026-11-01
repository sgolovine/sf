import type { Execution } from "#model/runtime";

/** Task/thread IDs the Supervisor reported, as plain text; sf builds no links for them. */
export function reportedIds(e: Pick<Execution, "taskId" | "threadId">) {
  return [e.taskId && `task ${e.taskId}`, e.threadId && `thread ${e.threadId}`].filter(Boolean).join(", ");
}
