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
