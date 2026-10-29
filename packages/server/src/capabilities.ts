import type { Capabilities } from "@sf/protocol";

type Env = NodeJS.ProcessEnv;

/**
 * Best-effort capability detection from the environment. Scripts cannot see
 * the model or the agent's tool list, so the agent fills in the rest with
 * flags to `sf-factory start`.
 */
export function detectCapabilities(env: Env = process.env): Capabilities {
  const agent = env.CLAUDECODE ? "claude-code" : Object.keys(env).some((k) => k.startsWith("CODEX_")) ? "codex" : "unknown";
  const app = env.T3CODE_CLI_PATH || env.T3_ACP_MCP_NODE ? "t3-code" : env.HERDR_ENV ? "herdr" : "terminal";
  return {
    agent,
    model: env.ANTHROPIC_MODEL || env.CODEX_MODEL || "unknown",
    app,
    // T3 Code and Herdr can start new top-level threads; plain terminals cannot.
    canSpawnThreads: app !== "terminal",
    // Both Claude Code and Codex can run subagents.
    canSpawnSubagents: agent !== "unknown",
  };
}

type CapabilityFlags = Record<string, string | boolean | string[] | undefined>;

/** Merges explicit flags over detected values. */
export function resolveCapabilities(flags: CapabilityFlags, env: Env = process.env): Capabilities {
  const detected = detectCapabilities(env);
  const str = (key: string, fallback: string) => (typeof flags[key] === "string" ? (flags[key] as string) : fallback);
  const bool = (key: string, fallback: boolean) => {
    const v = flags[key];
    if (v === undefined) return fallback;
    return v === true || v === "true" || v === "yes" || v === "1";
  };
  const notes = flags.notes;
  return {
    agent: str("agent", detected.agent),
    model: str("model", detected.model),
    app: str("app", detected.app),
    canSpawnThreads: bool("can-spawn-threads", detected.canSpawnThreads),
    canSpawnSubagents: bool("can-spawn-subagents", detected.canSpawnSubagents),
    ...(typeof notes === "string" ? { notes } : {}),
  };
}
