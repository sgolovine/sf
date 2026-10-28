import {
  commands,
  routes,
  TOKEN_HEADER,
  type CommandRecord,
  type HostCommand,
  type ServerEvent,
  type SessionState,
  type SpawnSubagentCommand,
  type SpawnThreadCommand,
} from "@sf/protocol";

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

async function request<T>(method: string, pathname: string, body?: unknown): Promise<T> {
  const res = await fetch(pathname, {
    method,
    headers: { [TOKEN_HEADER]: token, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

/** Typed client for the sf-factory server. */
export const sfApi = {
  getState: () => request<SessionState>("GET", routes.state),

  /** Sends any command to the host thread. Resolves once it is queued, not when it is done. */
  send: (command: HostCommand) => request<CommandRecord>("POST", routes.commands, { command }),

  /** Ask the host to spawn a new top-level thread with `prompt`. */
  spawnThread: (prompt: string, opts?: Omit<SpawnThreadCommand, "type" | "prompt">) =>
    sfApi.send(commands.spawnThread(prompt, opts)),

  /** Ask the host to run `prompt` in a child agent it owns. */
  spawnSubagent: (prompt: string, opts?: Omit<SpawnSubagentCommand, "type" | "prompt">) =>
    sfApi.send(commands.spawnSubagent(prompt, opts)),

  /** Give the host thread a free-form instruction. */
  instruct: (text: string) => sfApi.send(commands.instruct(text)),

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
