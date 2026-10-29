import { EventEmitter } from "node:events";
import fs from "node:fs";
import type {
  Capabilities,
  CommandRecord,
  CommandResultRequest,
  FileChange,
  PostMessageRequest,
  ProjectSnapshot,
  SessionState,
  SupervisorCommand,
  SupervisorMessage,
} from "#protocol";

const MAX_FILE_CHANGES = 500;

/** In-memory session state, persisted to `sessionFile` so it survives restarts. */
export class Store extends EventEmitter {
  state: SessionState;
  private seq = 0;
  private waiting = 0;

  constructor(
    root: string,
    private sessionFile: string | null,
  ) {
    super();
    this.setMaxListeners(0);
    const loaded = this.load();
    this.state = {
      root,
      startedAt: Date.now(),
      supervisor: { capabilities: null, lastSeenAt: null, listening: false },
      commands: [],
      messages: [],
      ...loaded,
      fileChanges: [],
      project: null,
    };
    this.state.supervisor.listening = false;
    // A command claimed by a Supervisor that went away goes back to the queue.
    for (const c of this.state.commands) if (c.status === "claimed") c.status = "pending";
    this.seq = this.state.commands.length + this.state.messages.length;
  }

  enqueue(command: SupervisorCommand): CommandRecord {
    const record: CommandRecord = { id: this.nextId("c"), command, status: "pending", createdAt: Date.now() };
    this.state.commands.push(record);
    this.changed();
    this.emit("command");
    return record;
  }

  /** Claims the oldest pending command, or returns null. */
  claim(): CommandRecord | null {
    this.seen();
    const record = this.state.commands.find((c) => c.status === "pending");
    if (!record) return null;
    record.status = "claimed";
    record.claimedAt = Date.now();
    this.changed();
    return record;
  }

  /** Marks a command cancelled; a cancelled command ignores later results. */
  cancel(id: string) {
    const record = this.state.commands.find((c) => c.id === id);
    if (!record) return;
    record.status = "cancelled";
    record.finishedAt = Date.now();
    this.changed();
  }

  finish(id: string, body: CommandResultRequest): CommandRecord | null {
    const record = this.state.commands.find((c) => c.id === id);
    if (!record) return null;
    this.seen();
    if (record.status === "cancelled") return record;
    record.status = body.ok ? "done" : "failed";
    record.finishedAt = Date.now();
    if (body.ok) record.result = body.result;
    else record.error = body.error;
    this.changed();
    return record;
  }

  setCapabilities(capabilities: Capabilities) {
    this.state.supervisor.capabilities = capabilities;
    this.seen();
    this.changed();
  }

  addMessage({ text, level = "info", commandId }: PostMessageRequest): SupervisorMessage {
    const message: SupervisorMessage = { id: this.nextId("m"), text, level, commandId, createdAt: Date.now() };
    this.state.messages.push(message);
    this.seen();
    this.changed();
    return message;
  }

  addFileChanges(changes: FileChange[]) {
    this.state.fileChanges.push(...changes);
    this.state.fileChanges.splice(0, this.state.fileChanges.length - MAX_FILE_CHANGES);
    this.changed({ persist: false });
  }

  /** The Project lives on disk; this is only the latest read for the UI. */
  setProject(project: ProjectSnapshot | null) {
    this.state.project = project;
    this.changed({ persist: false });
  }

  /** Tracks Supervisors blocked in a long-poll so the UI can show "listening". */
  listen(): () => void {
    this.waiting++;
    this.state.supervisor.listening = true;
    this.seen();
    this.changed({ persist: false });
    return () => {
      this.waiting--;
      this.state.supervisor.listening = this.waiting > 0;
      this.changed({ persist: false });
    };
  }

  private seen() {
    this.state.supervisor.lastSeenAt = Date.now();
  }

  private nextId(prefix: string) {
    return `${prefix}${++this.seq}`;
  }

  private changed({ persist = true } = {}) {
    if (persist && this.sessionFile) {
      const { root, startedAt, supervisor, commands, messages } = this.state;
      fs.writeFileSync(this.sessionFile, JSON.stringify({ root, startedAt, supervisor, commands, messages }, null, 2));
    }
    this.emit("state", this.state);
  }

  private load(): Partial<SessionState> | null {
    if (!this.sessionFile) return null;
    try {
      return JSON.parse(fs.readFileSync(this.sessionFile, "utf8")) as Partial<SessionState>;
    } catch {
      return null;
    }
  }
}
