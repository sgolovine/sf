import type { CommandRecord } from "./commands.ts";
import type { ProjectSnapshot } from "./project.ts";
import type { SupervisorInfo, SupervisorMessage } from "./supervisor.ts";

export type FileChange = {
  /** Path relative to the Project root. */
  path: string;
  event: "rename" | "change";
  at: number;
};

export type SessionState = {
  /** Project root (the directory holding `.sf`). */
  root: string;
  startedAt: number;
  supervisor: SupervisorInfo;
  commands: CommandRecord[];
  messages: SupervisorMessage[];
  fileChanges: FileChange[];
  /** Null until the Project is initialized. */
  project: ProjectSnapshot | null;
};

/** Server-sent event payloads on GET /api/events. */
export type ServerEvent = { type: "state"; state: SessionState };
