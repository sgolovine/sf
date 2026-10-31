// Commands the server and the web interface queue for the Supervisor (the
// agent thread running the sf skill).
//
// Flow: the server enqueues a SupervisorCommand (a `worker.spawn` when a Story
// Moves into a Stage with an enabled Stage Prompt, `execution.reconcile` or
// `execution.cancel` about an earlier launch, or a `supervisor.instruct` from
// the UI) → the Supervisor claims it with `sf next` → does the work and reports
// back with `sf done|fail`. The Supervisor can also push SupervisorMessages to
// the UI with `sf say`.

import type { ExecutionReport } from "./execution.ts";

/** The launch generation a command is about. */
export type ExecutionRef = {
  id: string;
  machineId: string;
  environmentId: string;
  projectId: string;
};

/**
 * The configured machine placement selected for a Worker. sf only requests it:
 * the Supervisor's harness owns machine handling, and this is never evidence
 * that the Worker runs there.
 */
export type MachineRequest = {
  /** Configured machine id (the stable slug in `scheduling.remotes`). */
  id: string;
  name: string;
  environmentId: string;
  projectId: string;
  repository: string;
  /** The Story's placement intent; `default` means the Project's machine order chose it. */
  placement: "required" | "preferred" | "default";
  /** Whether the harness may start the Worker on the Supervisor's machine instead. */
  localFallback: boolean;
  /** Readable instructions for the launcher; the brief ends with the same text. */
  instructions: string;
};

/** Start a Worker for one Story in one Stage. Queued by the server, never by the UI. */
export type WorkerSpawnCommand = {
  type: "worker.spawn";
  workerId: string;
  storyKey: string;
  /** Board id. */
  board: string;
  stageId: string;
  /** A new top-level thread when the Supervisor can spawn threads, otherwise a subagent. */
  mode: "thread" | "subagent";
  agent?: string;
  model?: string;
  /** The Story Worktree; it exists by the time the Supervisor claims the command. */
  worktree: { path: string; branch: string };
  /** The Worker Brief: the full prompt for the Worker. */
  brief: string;
  /** Durable launch identity; use `execution.id` as the launch request key where a tool takes one. */
  execution?: ExecutionRef;
  /** Present when placement selected a configured remote: start the Worker there. Absent: launch locally. */
  machine?: MachineRequest;
};

/** Ask the Supervisor what happened to an earlier launch. Never a request to launch again. */
export type ExecutionReconcileCommand = {
  type: "execution.reconcile";
  execution: ExecutionRef;
  attemptId: string;
  workerId: string;
  storyKey: string;
  mode: "thread" | "subagent";
  worktree: { path: string; branch: string };
  taskId?: string;
  threadId?: string;
  label?: string;
};

/** Ask the Supervisor to stop an execution. Acknowledgement alone is not termination. */
export type ExecutionCancelCommand = Omit<ExecutionReconcileCommand, "type"> & { type: "execution.cancel" };

export type SupervisorInstructCommand = {
  type: "supervisor.instruct";
  /** Free-form instruction for the Supervisor itself. */
  text: string;
};

export type SupervisorCommand =
  | WorkerSpawnCommand
  | ExecutionReconcileCommand
  | ExecutionCancelCommand
  | SupervisorInstructCommand;
export type SupervisorCommandType = SupervisorCommand["type"];

/**
 * `cancelled`: withdrawn before the Supervisor received it. `interrupted`: the
 * server restarted while the Supervisor held it; it is never delivered again.
 */
export type CommandStatus = "pending" | "claimed" | "done" | "failed" | "cancelled" | "interrupted";

export type CommandRecord = {
  id: string;
  command: SupervisorCommand;
  status: CommandStatus;
  createdAt: number;
  claimedAt?: number;
  finishedAt?: number;
  /** Free-form result the Supervisor reported, e.g. the new thread id. */
  result?: string;
  error?: string;
  /** Structured execution evidence from the result. */
  execution?: ExecutionReport;
  /** Publication key: one record per launch generation or attempt. */
  key?: string;
  /** Results reported after the command was cancelled or interrupted; kept as evidence. */
  late?: { at: number; ok: boolean; result?: string; error?: string; execution?: ExecutionReport }[];
};

/** Builders for the commands the UI can send to the Supervisor. */
export const commands = {
  instruct: (text: string): SupervisorInstructCommand => ({ type: "supervisor.instruct", text }),
};

/** Returns an error message, or null when `value` is a command the UI may send. */
export function validateCommand(value: unknown): string | null {
  if (!value || typeof value !== "object") return "command must be an object";
  const c = value as Record<string, unknown>;
  if (c.type !== "supervisor.instruct") return "command.type must be supervisor.instruct";
  if (typeof c.text !== "string" || !c.text.trim()) return "command.text must be a non-empty string";
  return null;
}
