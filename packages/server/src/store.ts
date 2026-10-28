import { EventEmitter } from "node:events";
import fs from "node:fs";
import type {
  Capabilities,
  CommandRecord,
  CommandResultRequest,
  FileChange,
  HostCommand,
  HostMessage,
  PostMessageRequest,
  SessionState,
} from "@sf/protocol";

const MAX_FILE_CHANGES = 500;

/** In-memory session state, persisted to `sessionFile` so it survives restarts. */
export class Store extends EventEmitter {
  state: SessionState;
  private seq = 0;
  private waiting = 0;

  constructor(
    workspace: string,
    private sessionFile: string | null,
  ) {
    super();
    this.setMaxListeners(0);
    this.state = this.load() ?? {
      workspace,
      startedAt: Date.now(),
      host: { capabilities: null, lastSeenAt: null, listening: false },
      commands: [],
      messages: [],
      fileChanges: [],
    };
    this.state.host.listening = false;
    // A command claimed by a host that went away goes back to the queue.
    for (const c of this.state.commands) if (c.status === "claimed") c.status = "pending";
    this.seq = this.state.commands.length + this.state.messages.length;
  }

  enqueue(command: HostCommand): CommandRecord {
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

  finish(id: string, body: CommandResultRequest): CommandRecord | null {
    const record = this.state.commands.find((c) => c.id === id);
    if (!record) return null;
    record.status = body.ok ? "done" : "failed";
    record.finishedAt = Date.now();
    if (body.ok) record.result = body.result;
    else record.error = body.error;
    this.seen();
    this.changed();
    return record;
  }

  setCapabilities(capabilities: Capabilities) {
    this.state.host.capabilities = capabilities;
    this.seen();
    this.changed();
  }

  addMessage({ text, level = "info", commandId }: PostMessageRequest): HostMessage {
    const message: HostMessage = { id: this.nextId("m"), text, level, commandId, createdAt: Date.now() };
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

  /** Tracks hosts blocked in a long-poll so the UI can show "listening". */
  listen(): () => void {
    this.waiting++;
    this.state.host.listening = true;
    this.seen();
    this.changed({ persist: false });
    return () => {
      this.waiting--;
      this.state.host.listening = this.waiting > 0;
      this.changed({ persist: false });
    };
  }

  private seen() {
    this.state.host.lastSeenAt = Date.now();
  }

  private nextId(prefix: string) {
    return `${prefix}${++this.seq}`;
  }

  private changed({ persist = true } = {}) {
    if (persist && this.sessionFile)
      fs.writeFileSync(this.sessionFile, JSON.stringify({ ...this.state, fileChanges: [] }, null, 2));
    this.emit("state", this.state);
  }

  private load(): SessionState | null {
    if (!this.sessionFile) return null;
    try {
      return JSON.parse(fs.readFileSync(this.sessionFile, "utf8")) as SessionState;
    } catch {
      return null;
    }
  }
}
