import { EventEmitter } from "node:events";
import fs from "node:fs";
import type { CommandResultRequest, PostMessageRequest } from "#model/api";
import type { CommandRecord, SupervisorCommand } from "#model/commands";
import type { ProjectSnapshot } from "#model/project";
import type { FileChange, SessionState } from "#model/session";
import type { Capabilities, SupervisorMessage } from "#model/supervisor";

const MAX_FILE_CHANGES = 500;

/** In-memory session state, persisted to `sessionFile` so it survives restarts. */
export type Store = {
  state: SessionState;
  sessionFile: string | null;
  events: EventEmitter;
  seq: number;
  /** Supervisors blocked in a long-poll. */
  waiting: number;
};

function create(root: string, sessionFile: string | null): Store {
  const events = new EventEmitter();
  events.setMaxListeners(0);
  const state: SessionState = {
    root,
    startedAt: Date.now(),
    supervisor: { capabilities: null, lastSeenAt: null, listening: false },
    commands: [],
    messages: [],
    ...load(sessionFile),
    fileChanges: [],
    project: null,
  };
  state.supervisor.listening = false;
  // A command claimed by a Supervisor that went away goes back to the queue.
  for (const c of state.commands) if (c.status === "claimed") c.status = "pending";
  return { state, sessionFile, events, seq: state.commands.length + state.messages.length, waiting: 0 };
}

function enqueue(store: Store, command: SupervisorCommand): CommandRecord {
  const record: CommandRecord = { id: nextId(store, "c"), command, status: "pending", createdAt: Date.now() };
  store.state.commands.push(record);
  changed(store);
  store.events.emit("command");
  return record;
}

/** Claims the oldest pending command, or returns null. */
function claim(store: Store): CommandRecord | null {
  seen(store);
  const record = store.state.commands.find((c) => c.status === "pending");
  if (!record) return null;
  record.status = "claimed";
  record.claimedAt = Date.now();
  changed(store);
  return record;
}

/** Marks a command cancelled; a cancelled command ignores later results. */
function cancel(store: Store, id: string) {
  const record = store.state.commands.find((c) => c.id === id);
  if (!record) return;
  record.status = "cancelled";
  record.finishedAt = Date.now();
  changed(store);
}

function finish(store: Store, id: string, body: CommandResultRequest): CommandRecord | null {
  const record = store.state.commands.find((c) => c.id === id);
  if (!record) return null;
  seen(store);
  if (record.status === "cancelled") return record;
  record.status = body.ok ? "done" : "failed";
  record.finishedAt = Date.now();
  if (body.ok) record.result = body.result;
  else record.error = body.error;
  changed(store);
  return record;
}

function setCapabilities(store: Store, capabilities: Capabilities) {
  store.state.supervisor.capabilities = capabilities;
  seen(store);
  changed(store);
}

function addMessage(store: Store, { text, level = "info", commandId }: PostMessageRequest): SupervisorMessage {
  const message: SupervisorMessage = { id: nextId(store, "m"), text, level, commandId, createdAt: Date.now() };
  store.state.messages.push(message);
  seen(store);
  changed(store);
  return message;
}

function addFileChanges(store: Store, changes: FileChange[]) {
  store.state.fileChanges.push(...changes);
  store.state.fileChanges.splice(0, store.state.fileChanges.length - MAX_FILE_CHANGES);
  changed(store, { persist: false });
}

/** The Project lives on disk; this is only the latest read for the UI. */
function setProject(store: Store, project: ProjectSnapshot | null) {
  store.state.project = project;
  changed(store, { persist: false });
}

/** Tracks Supervisors blocked in a long-poll so the UI can show "listening". Returns an unlisten function. */
function listen(store: Store): () => void {
  store.waiting++;
  store.state.supervisor.listening = true;
  seen(store);
  changed(store, { persist: false });
  return () => {
    store.waiting--;
    store.state.supervisor.listening = store.waiting > 0;
    changed(store, { persist: false });
  };
}

/** Calls `fn` on every state change. Returns an unsubscribe function. */
function onState(store: Store, fn: (state: SessionState) => void): () => void {
  store.events.on("state", fn);
  return () => store.events.off("state", fn);
}

/** Calls `fn` whenever a command is enqueued. Returns an unsubscribe function. */
function onCommand(store: Store, fn: () => void): () => void {
  store.events.on("command", fn);
  return () => store.events.off("command", fn);
}

function seen(store: Store) {
  store.state.supervisor.lastSeenAt = Date.now();
}

function nextId(store: Store, prefix: string) {
  return `${prefix}${++store.seq}`;
}

function changed(store: Store, { persist = true } = {}) {
  if (persist && store.sessionFile) {
    const { root, startedAt, supervisor, commands, messages } = store.state;
    fs.writeFileSync(store.sessionFile, JSON.stringify({ root, startedAt, supervisor, commands, messages }, null, 2));
  }
  store.events.emit("state", store.state);
}

function load(sessionFile: string | null): Partial<SessionState> | null {
  if (!sessionFile) return null;
  try {
    return JSON.parse(fs.readFileSync(sessionFile, "utf8")) as Partial<SessionState>;
  } catch {
    return null;
  }
}

export const StoreService = {
  create,
  enqueue,
  claim,
  cancel,
  finish,
  setCapabilities,
  addMessage,
  addFileChanges,
  setProject,
  listen,
  onState,
  onCommand,
};
