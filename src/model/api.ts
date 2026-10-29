import type { CommandRecord, SupervisorCommand } from "./commands.ts";
import type { BoardConfig, BoardOverrides, FieldDef } from "./config.ts";
import type { StoryView } from "./project.ts";
import type { Claim, RuntimeState } from "./runtime.ts";
import type { FileChange } from "./session.ts";
import type { SupervisorMessage } from "./supervisor.ts";

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
  hilFlag?: string | null;
  hilComment?: string | null;
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

export type SfErrorCode = "claim_gone" | "claimed" | "invalid" | "not_found" | "no_project";

/** A Story with its runtime status, as returned by the story routes. */
export type StoryDetails = StoryView & {
  claim?: Claim;
  /** True while the Story waits for a Worker slot. */
  queued?: boolean;
  failure?: RuntimeState["failures"][string];
  worktreeWarning?: RuntimeState["worktreeWarnings"][string];
  /** Set while the Story's HIL flag for its Stage is true: it waits for a human. */
  hil?: { flag: string; comment?: string };
};
