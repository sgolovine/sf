// Shared contract between the web interface, the Express server, and the host
// thread (the agent running the sf-factory skill).
//
// Flow: the UI enqueues a HostCommand → the host thread claims it with
// `sf-factory next` → the host does the work and reports back with
// `sf-factory done|fail`. The host can also push HostMessages to the UI with
// `sf-factory say`.

// ---------- Commands (UI → host thread) ----------

export type SpawnThreadCommand = {
  type: "thread.spawn";
  /** Prompt for the new top-level thread. */
  prompt: string;
  title?: string;
  /** Model id to run the thread on. Defaults to the host's choice. */
  model?: string;
  /** Where the thread works: the main checkout or a new worktree. */
  workspace?: "root" | "worktree";
  /** Branch for a worktree thread. */
  branch?: string;
};

export type SpawnSubagentCommand = {
  type: "subagent.spawn";
  /** Task for a child agent owned by the host thread. */
  prompt: string;
  model?: string;
};

export type InstructCommand = {
  type: "host.instruct";
  /** Free-form instruction for the host thread itself. */
  text: string;
};

export type HostCommand = SpawnThreadCommand | SpawnSubagentCommand | InstructCommand;
export type HostCommandType = HostCommand["type"];

export type CommandStatus = "pending" | "claimed" | "done" | "failed";

export type CommandRecord = {
  id: string;
  command: HostCommand;
  status: CommandStatus;
  createdAt: number;
  claimedAt?: number;
  finishedAt?: number;
  /** Free-form result the host reported, e.g. the new thread id. */
  result?: string;
  error?: string;
};

/** Builders for the commands the UI can send to the host thread. */
export const commands = {
  spawnThread: (prompt: string, opts: Omit<SpawnThreadCommand, "type" | "prompt"> = {}): SpawnThreadCommand => ({
    type: "thread.spawn",
    prompt,
    ...opts,
  }),
  spawnSubagent: (prompt: string, opts: Omit<SpawnSubagentCommand, "type" | "prompt"> = {}): SpawnSubagentCommand => ({
    type: "subagent.spawn",
    prompt,
    ...opts,
  }),
  instruct: (text: string): InstructCommand => ({ type: "host.instruct", text }),
};

const COMMAND_TYPES: readonly HostCommandType[] = ["thread.spawn", "subagent.spawn", "host.instruct"];

/** Returns an error message, or null when `value` is a valid HostCommand. */
export function validateCommand(value: unknown): string | null {
  if (!value || typeof value !== "object") return "command must be an object";
  const c = value as Record<string, unknown>;
  if (!COMMAND_TYPES.includes(c.type as HostCommandType))
    return `command.type must be one of ${COMMAND_TYPES.join(", ")}`;
  const textField = c.type === "host.instruct" ? "text" : "prompt";
  if (typeof c[textField] !== "string" || !(c[textField] as string).trim())
    return `command.${textField} must be a non-empty string`;
  if (c.workspace !== undefined && c.workspace !== "root" && c.workspace !== "worktree")
    return 'command.workspace must be "root" or "worktree"';
  return null;
}

// ---------- Host thread ----------

export type Capabilities = {
  /** Agent harness, e.g. "claude-code", "codex". */
  agent: string;
  /** Model id the host thread runs on. */
  model: string;
  /** Host app wrapping the agent, e.g. "t3-code", "herdr", "terminal". */
  host: string;
  /** Can start new top-level threads/conversations. */
  canSpawnThreads: boolean;
  /** Can start child agents owned by this thread. */
  canSpawnSubagents: boolean;
  notes?: string;
};

export type HostInfo = {
  capabilities: Capabilities | null;
  /** Last time the host talked to the server. */
  lastSeenAt: number | null;
  /** True while the host is blocked in `sf-factory next`. */
  listening: boolean;
};

export type HostMessage = {
  id: string;
  text: string;
  level: "info" | "warn" | "error";
  /** Command this message is about, if any. */
  commandId?: string;
  createdAt: number;
};

// ---------- File watching ----------

export type FileChange = {
  /** Path relative to the workspace. */
  path: string;
  event: "rename" | "change";
  at: number;
};

// ---------- Server state ----------

export type SessionState = {
  workspace: string;
  startedAt: number;
  host: HostInfo;
  commands: CommandRecord[];
  messages: HostMessage[];
  fileChanges: FileChange[];
};

/** Server-sent event payloads on GET /api/events. */
export type ServerEvent = { type: "state"; state: SessionState };

// ---------- HTTP API ----------

export const TOKEN_HEADER = "authToken";

export const routes = {
  state: "/api/state",
  events: "/api/events",
  commands: "/api/commands",
  nextCommand: "/api/commands/next",
  commandResult: (id: string) => `/api/commands/${encodeURIComponent(id)}/result`,
  capabilities: "/api/host/capabilities",
  messages: "/api/host/messages",
  fileChanges: "/api/files/changes",
  stop: "/api/stop",
} as const;

export type EnqueueCommandRequest = { command: HostCommand };
export type EnqueueCommandResponse = CommandRecord;
/** GET /api/commands/next?wait=<seconds> → 200 with a claimed command, or 204 on timeout. */
export type NextCommandResponse = CommandRecord;
export type CommandResultRequest = { ok: true; result?: string } | { ok: false; error: string };
export type PostMessageRequest = { text: string; level?: HostMessage["level"]; commandId?: string };
export type FileChangesResponse = { changes: FileChange[] };

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
