import { EventEmitter } from "node:events";
import fs from "node:fs";
import type { CommandResultRequest, PostMessageRequest } from "#model/api";
import type { CommandRecord, SupervisorCommand } from "#model/commands";
import type { ProjectSnapshot } from "#model/project";
import type { FileChange, SessionState } from "#model/session";
import type { Capabilities, SupervisorMessage } from "#model/supervisor";
import pkg from "../../../package.json" with { type: "json" };
import { atomicWrite } from "../project/fsutil.ts";

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
    version: pkg.version,
    fileChanges: [],
    project: null,
  };
  state.supervisor.listening = false;
  // A claimed instruction goes back to the queue. A claimed execution command may
  // have been acted on, so it is never delivered again; sf reconciles it instead.
  for (const c of state.commands)
    if (c.status === "claimed") c.status = c.command.type === "supervisor.instruct" ? "pending" : "interrupted";
  return { state, sessionFile, events, seq: state.commands.length + state.messages.length, waiting: 0 };
}

/**
 * Queues a command. With a `key`, returns the existing record for that key
 * instead, unless it was cancelled or interrupted before delivery completed.
 * Throws when the session cannot be saved; the command is then not queued.
 */
function enqueue(store: Store, command: SupervisorCommand, key?: string): CommandRecord {
  const existing =
    key && store.state.commands.find((c) => c.key === key && c.status !== "cancelled" && c.status !== "interrupted");
  if (existing) return existing;
  const record: CommandRecord = {
    id: nextId(store, "c"),
    command,
    status: "pending",
    createdAt: Date.now(),
    ...(key ? { key } : {}),
  };
  store.state.commands.push(record);
  try {
    changed(store);
  } catch (err) {
    store.state.commands.pop();
    throw err;
  }
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

/** Returns a claimed command to the queue when it was never delivered. */
function unclaim(store: Store, id: string) {
  const record = store.state.commands.find((c) => c.id === id);
  if (record?.status !== "claimed") return;
  record.status = "pending";
  delete record.claimedAt;
  changed(store);
  store.events.emit("command");
}

/** Marks a command cancelled: withdrawn before delivery. Later results are kept as evidence only. */
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
  if (record.status !== "pending" && record.status !== "claimed") {
    // Late or duplicate: keep the evidence without changing the outcome.
    const late = { at: Date.now(), ok: body.ok, ...(body.ok ? { result: body.result } : { error: body.error }) };
    record.late = [...(record.late ?? []), { ...late, ...(body.execution ? { execution: body.execution } : {}) }];
    changed(store);
    return record;
  }
  record.status = body.ok ? "done" : "failed";
  record.finishedAt = Date.now();
  if (body.ok) record.result = body.result;
  else record.error = body.error;
  if (body.execution) record.execution = body.execution;
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
    atomicWrite(store.sessionFile, JSON.stringify({ root, startedAt, supervisor, commands, messages }, null, 2));
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

function commandStatus(store: Store, id: string) {
  return store.state.commands.find((c) => c.id === id)?.status;
}

export const StoreService = {
  create,
  enqueue,
  claim,
  unclaim,
  cancel,
  commandStatus,
  finish,
  setCapabilities,
  addMessage,
  addFileChanges,
  setProject,
  listen,
  onState,
  onCommand,
};
