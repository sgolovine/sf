// Shared contract between the web interface, the Express server, and the
// Supervisor (the agent thread running the sf-factory skill).
//
// Flow: the server enqueues a SupervisorCommand (a `worker.spawn` when a Story
// Moves into a Stage with an enabled Stage Prompt, or a `supervisor.instruct`
// from the UI) → the Supervisor claims it with `sf next` → does the
// work and reports back with `sf done|fail`. The Supervisor can also
// push SupervisorMessages to the UI with `sf say`.

// ---------- Commands (server/UI → Supervisor) ----------

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

// ---------- Supervisor ----------

export type Capabilities = {
  /** Agent harness, e.g. "claude-code", "codex". */
  agent: string;
  /** Model id the Supervisor runs on. */
  model: string;
  /** App wrapping the agent, e.g. "t3-code", "herdr", "terminal". */
  app: string;
  /** Can start new top-level threads/conversations. */
  canSpawnThreads: boolean;
  /** Can start child agents owned by this thread. */
  canSpawnSubagents: boolean;
  notes?: string;
};

export type SupervisorInfo = {
  capabilities: Capabilities | null;
  /** Last time the Supervisor talked to the server. */
  lastSeenAt: number | null;
  /** True while the Supervisor is blocked in `sf next`. */
  listening: boolean;
};

export type SupervisorMessage = {
  id: string;
  text: string;
  level: "info" | "warn" | "error";
  /** Command this message is about, if any. */
  commandId?: string;
  createdAt: number;
};

// ---------- File watching ----------

export type FileChange = {
  /** Path relative to the Project root. */
  path: string;
  event: "rename" | "change";
  at: number;
};

// ---------- Server state ----------

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

// ---------- HTTP API ----------

export const TOKEN_HEADER = "authToken";

const enc = encodeURIComponent;

export const routes = {
  state: "/api/state",
  events: "/api/events",
  commands: "/api/commands",
  nextCommand: "/api/commands/next",
  commandResult: (id: string) => `/api/commands/${enc(id)}/result`,
  capabilities: "/api/supervisor/capabilities",
  messages: "/api/supervisor/messages",
  fileChanges: "/api/files/changes",
  stop: "/api/stop",
  project: "/api/project",
  projectInit: "/api/project/init",
  boards: "/api/boards",
  board: (board: string) => `/api/boards/${enc(board)}`,
  stages: (board: string) => `/api/boards/${enc(board)}/stages`,
  stage: (board: string, stage: string) => `/api/boards/${enc(board)}/stages/${enc(stage)}`,
  stageReorder: (board: string, stage: string) => `/api/boards/${enc(board)}/stages/${enc(stage)}/reorder`,
  stories: "/api/stories",
  story: (key: string) => `/api/stories/${enc(key)}`,
  storyMove: (key: string) => `/api/stories/${enc(key)}/move`,
  storyRelease: (key: string) => `/api/stories/${enc(key)}/release`,
  storyForceRelease: (key: string) => `/api/stories/${enc(key)}/force-release`,
  storyRetry: (key: string) => `/api/stories/${enc(key)}/retry`,
  storyWorktree: (key: string) => `/api/stories/${enc(key)}/worktree`,
} as const;

export type EnqueueCommandRequest = { command: SupervisorCommand };
export type EnqueueCommandResponse = CommandRecord;
/** GET /api/commands/next?wait=<seconds> → 200 with a claimed command, or 204 on timeout. */
export type NextCommandResponse = CommandRecord;
export type CommandResultRequest = { ok: true; result?: string } | { ok: false; error: string };
export type PostMessageRequest = { text: string; level?: SupervisorMessage["level"]; commandId?: string };
export type FileChangesResponse = { changes: FileChange[] };

/** Every error response. `code` is set for sf rejections; 409 means `claim_gone` or `claimed`. */
export type ErrorResponse = { error: string; code?: SfErrorCode };

export type CreateBoardRequest = { name: string; key: string };
export type UpdateBoardRequest = { name?: string; schema?: FieldDef[]; overrides?: BoardOverrides };
export type BoardResponse = { id: string; config: BoardConfig; prompts?: Record<string, string> };
export type AddStageRequest = { name: string; after?: string };
export type UpdateStageRequest = {
  name?: string;
  promptEnabled?: boolean;
  prompt?: string;
  agent?: string | null;
  model?: string | null;
};
export type ReorderStageRequest = { index: number };
export type CreateStoryRequest = {
  board: string;
  title: string;
  stage?: string;
  fields?: Record<string, unknown>;
  body?: string;
  worker?: string;
};
/** A null field value clears the field. */
export type UpdateStoryRequest = { title?: string; fields?: Record<string, unknown>; body?: string; worker?: string };
export type MoveStoryRequest = { stage: string; worker?: string };
export type ReleaseStoryRequest = { worker: string };
export type WorktreeRequest = { action: "ensure" | "remove"; force?: boolean };
export type WorktreeResponse = { path: string; branch: string; removed?: boolean; reason?: string };

// ---------- Project (.sf) ----------

export type FieldType = "text" | "number" | "single-select" | "multi-select" | "boolean" | "date";
export const FIELD_TYPES: readonly FieldType[] = ["text", "number", "single-select", "multi-select", "boolean", "date"];

/** A custom field in a Board's Story schema. `options` is for the select types. */
export type FieldDef = { id: string; name: string; type: FieldType; options?: string[] };

export type StageConfig = {
  /** Stable slug id; never changes on rename. */
  id: string;
  name: string;
  promptEnabled: boolean;
  agent?: string | null;
  model?: string | null;
};

export type WorkerSettings = { agent: string | null; model: string | null };

/** `.sf/sf.config.json`. */
export type ProjectConfig = {
  version: 1;
  worker: WorkerSettings;
  worktree: { baseBranch: string | null };
  claimTimeoutMinutes: number;
  briefPreamble: string;
  /** Project-wide; cannot be overridden per Board. */
  maxConcurrentWorkers: number;
};

export type BoardOverrides = {
  worker?: Partial<WorkerSettings>;
  worktree?: { baseBranch?: string | null };
  claimTimeoutMinutes?: number;
  briefPreamble?: string;
};

/** `.sf/boards/<id>/board.config.json`. */
export type BoardConfig = {
  key: string;
  name: string;
  stages: StageConfig[];
  schema: FieldDef[];
  overrides: BoardOverrides;
};

export type StoryView = {
  key: string;
  /** Board id. */
  board: string;
  title: string;
  stage: string;
  branch?: string;
  /** Custom field values by field id, plus any frontmatter keys the schema does not know. */
  fields: Record<string, unknown>;
  body: string;
};

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
  failures: Record<string, { stageId: string; error: string; at: number }>;
  worktreeWarnings: Record<string, { path: string; branch: string; reason: string; at: number }>;
  workers: Record<string, WorkerRecord>;
  /** Triggers written while no server was running; run on the next start. */
  pendingTriggers: { type: "spawn" | "cleanup"; storyKey: string; stageId?: string; at: number }[];
};

export type BoardSnapshot = {
  id: string;
  config: BoardConfig;
  /** Stage Prompt text by Stage id. */
  prompts: Record<string, string>;
  stories: StoryView[];
};

export type ProjectSnapshot = {
  root: string;
  config: ProjectConfig;
  boards: BoardSnapshot[];
  runtime: RuntimeState;
};

export type SfErrorCode = "claim_gone" | "claimed" | "invalid" | "not_found" | "no_project";

/** A Story with its runtime status, as returned by the story routes. */
export type StoryDetails = StoryView & {
  claim?: Claim;
  /** True while the Story waits for a Worker slot. */
  queued?: boolean;
  failure?: RuntimeState["failures"][string];
  worktreeWarning?: RuntimeState["worktreeWarnings"][string];
};
