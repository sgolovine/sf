import {
  routes,
  TOKEN_HEADER,
  type BoardResponse,
  type CreateStoryRequest,
  type ErrorResponse,
  type StoryDetails,
  type UpdateBoardRequest,
  type UpdateStageRequest,
  type UpdateStoryRequest,
  type WorktreeResponse,
} from "#model/api";
import { commands, type CommandRecord, type SupervisorCommand } from "#model/commands";
import type { ProjectConfig, StageConfig } from "#model/config";
import type { ServerEvent, SessionState } from "#model/session";

// The server prints the UI URL with the token in the fragment. Fragments are
// not sent in HTTP requests; the client sends the token in the authToken header.
const token = (() => {
  const fromUrl = new URLSearchParams(location.hash.slice(1)).get("authToken");
  if (fromUrl) {
    sessionStorage.setItem("sf-token", fromUrl);
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  }
  return fromUrl ?? sessionStorage.getItem("sf-token") ?? "";
})();

/** A server rejection. `code` is set for sf errors such as `claimed`. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, pathname: string, body?: unknown): Promise<T> {
  const res = await fetch(pathname, {
    method,
    headers: { [TOKEN_HEADER]: token, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & Partial<ErrorResponse>;
  if (!res.ok) throw new ApiError(json.error ?? `HTTP ${res.status}`, json.code);
  return json;
}

/** Typed client for the sf server. */
export const sfApi = {
  getState: () => request<SessionState>("GET", routes.state),

  /** Sends a command to the Supervisor. Resolves once it is queued, not when it is done. */
  send: (command: SupervisorCommand) => request<CommandRecord>("POST", routes.commands, { command }),

  /** Give the Supervisor a free-form instruction. */
  instruct: (text: string) => sfApi.send(commands.instruct(text)),

  initProject: () => request<ProjectConfig>("POST", routes.projectInit, {}),
  createBoard: (name: string, key: string) => request<BoardResponse>("POST", routes.boards, { name, key }),
  updateBoard: (board: string, patch: UpdateBoardRequest) => request<BoardResponse>("PATCH", routes.board(board), patch),
  addStage: (board: string, name: string, after?: string) =>
    request<StageConfig>("POST", routes.stages(board), { name, after }),
  updateStage: (board: string, stage: string, patch: UpdateStageRequest) =>
    request<StageConfig>("PATCH", routes.stage(board, stage), patch),
  reorderStage: (board: string, stage: string, index: number) =>
    request<StageConfig[]>("POST", routes.stageReorder(board, stage), { index }),
  removeStage: (board: string, stage: string) => request<StageConfig[]>("DELETE", routes.stage(board, stage)),

  createStory: (body: CreateStoryRequest) => request<StoryDetails>("POST", routes.stories, body),
  updateStory: (key: string, patch: UpdateStoryRequest) => request<StoryDetails>("PATCH", routes.story(key), patch),
  moveStory: (key: string, stage: string) => request<StoryDetails>("POST", routes.storyMove(key), { stage }),
  forceRelease: (key: string) => request<StoryDetails>("POST", routes.storyForceRelease(key), {}),
  retry: (key: string) => request<StoryDetails>("POST", routes.storyRetry(key), {}),
  removeWorktree: (key: string) =>
    request<WorktreeResponse>("POST", routes.storyWorktree(key), { action: "remove", force: true }),

  /** Subscribes to live state. Returns an unsubscribe function. */
  subscribe(onState: (state: SessionState) => void, onError?: () => void) {
    const controller = new AbortController();
    void (async () => {
      try {
        while (!controller.signal.aborted) {
          const res = await fetch(routes.events, {
            headers: { [TOKEN_HEADER]: token },
            signal: controller.signal,
          });
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (!controller.signal.aborted) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split("\n\n");
            buffer = blocks.pop() ?? "";
            for (const block of blocks) {
              const data = block.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
              if (!data) continue;
              const event = JSON.parse(data) as ServerEvent;
              if (event.type === "state") onState(event.state);
            }
          }
        }
      } catch {
        if (!controller.signal.aborted) onError?.();
      }
    })();
    return () => controller.abort();
  },
};
