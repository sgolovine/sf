// Commands the server and the web interface queue for the Supervisor (the
// agent thread running the sf skill).
//
// Flow: the server enqueues a SupervisorCommand (a `worker.spawn` when a Story
// Moves into a Stage with an enabled Stage Prompt, or a `supervisor.instruct`
// from the UI) → the Supervisor claims it with `sf next` → does the
// work and reports back with `sf done|fail`. The Supervisor can also
// push SupervisorMessages to the UI with `sf say`.

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
};

export type SupervisorInstructCommand = {
  type: "supervisor.instruct";
  /** Free-form instruction for the Supervisor itself. */
  text: string;
};

export type SupervisorCommand = WorkerSpawnCommand | SupervisorInstructCommand;
export type SupervisorCommandType = SupervisorCommand["type"];

/** `cancelled`: a `worker.spawn` whose Claim ended before the Supervisor claimed it. */
export type CommandStatus = "pending" | "claimed" | "done" | "failed" | "cancelled";

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
