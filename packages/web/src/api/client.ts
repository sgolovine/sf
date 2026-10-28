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

// The server prints the UI URL with ?t=<token>. Keep it for the session so
// reloads and client-side navigation don't lose it.
const token = (() => {
  const fromUrl = new URLSearchParams(location.search).get("t");
  if (fromUrl) sessionStorage.setItem("sf-token", fromUrl);
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
    const source = new EventSource(`${routes.events}?t=${encodeURIComponent(token)}`);
    source.onmessage = (e) => {
      const event = JSON.parse(e.data as string) as ServerEvent;
      if (event.type === "state") onState(event.state);
    };
    if (onError) source.onerror = onError;
    return () => source.close();
  },
};
