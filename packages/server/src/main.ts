// Supervisor-side CLI for the sf-factory skill. Runs the local server (Express
// API + web interface), lets the Supervisor talk to it, and changes the Project
// (.sf) for the UI, the Supervisor, and Workers. See HELP for commands.

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  routes,
  type CommandRecord,
  type FileChangesResponse,
  type SessionState,
  type SupervisorMessage,
} from "@sf/protocol";
import { detectCapabilities, resolveCapabilities } from "./capabilities.ts";
import { PROJECT_COMMANDS, PROJECT_HELP, runProjectCommand, type Flags } from "./cli/story.ts";
import { api, uiUrl, type ServerInfo } from "./client.ts";
import { shellQuote } from "./project/brief.ts";
import { isRejection } from "./project/errors.ts";
import { resolveProjectRoot, sfPaths } from "./project/paths.ts";
import { createService } from "./project/service.ts";
import { createApp, createOnlineService, listen, refreshProject } from "./server.ts";
import { Store } from "./store.ts";
import { watchFiles } from "./watcher.ts";

const HELP = `sf-factory: Supervisor-side CLI for the sf-factory skill. It runs the local
server (Express API + web interface), lets the Supervisor talk to it, and
changes the Project (.sf).

  sf-factory capabilities                  print detected agent/app capabilities (JSON)
  sf-factory start [capability flags]      init .sf if needed, start the server, register, open the UI
  sf-factory next [--timeout <s>]          wait for and claim the next command (e.g. worker.spawn)
  sf-factory done <id> [--result "..."]    report a command as finished (worker.spawn: the thread id)
  sf-factory fail <id> --error "..."       report a command as failed
  sf-factory say "<text>" [--level warn]   post a message to the UI
  sf-factory changes [--since <ms>]        list file changes seen by the watcher
  sf-factory status | url | stop

Capability flags: --agent, --model, --app, --can-spawn-threads <bool>,
--can-spawn-subagents <bool>, --notes. Other flags: --json, --no-open,
--project <dir> (default: $SF_PROJECT, then the current directory).
\`next\` exits 0 with a command, 2 on timeout, 1 on error.

${PROJECT_HELP}`;

const SCRIPT = fileURLToPath(import.meta.url);
const IDLE_SHUTDOWN_MS = 6 * 60 * 60 * 1000;
// The server exits when the Supervisor has not been heard from for this long. It
// does not count while the Supervisor is long-polling, a command is claimed, or
// a Worker holds a Claim.
const SUPERVISOR_HEARTBEAT_MS = 120 * 1000;
const HEARTBEAT_CHECK_MS = 10 * 1000;
const SWEEP_MS = 60 * 1000;
const POLL_SECONDS = 25;
const BOOLEAN_FLAGS = new Set(["json", "no-open", "dev", "force"]);
const REPEATABLE_FLAGS = new Set(["field"]);

type DevServerInfo = ServerInfo & { uiBase?: string };

const { cmd, positional, flags } = parseArgs(process.argv.slice(2));
const root = resolveProjectRoot(str(flags.project), process.env, process.cwd());
const paths = sfPaths(root);
// The command line that runs this script, for Worker Briefs.
const SF_COMMAND = [process.execPath, ...process.execArgv, SCRIPT].map(shellQuote).join(" ");

try {
  await main();
} catch (err) {
  console.error(`sf-factory: ${(err as Error).message}`);
  process.exit(isRejection(err) ? 3 : 1);
}

async function main() {
  if (flags.worker !== undefined && !str(flags.project))
    throw new Error("--worker needs --project <abs path> (the Supervisor's checkout)");
  if (cmd && PROJECT_COMMANDS.has(cmd)) return runProjectCommand(cmd, positional, flags, root, await findServer());
  switch (cmd) {
    case "serve":
      return serve();
    case "capabilities":
      return console.log(JSON.stringify(detectCapabilities(), null, 2));
    case "start": {
      createService({ root, online: false }).init();
      const server = await ensureServer();
      const supervisor = await api(server, "POST", routes.capabilities, resolveCapabilities(flags));
      if (!flags["no-open"] && !process.env.SF_FACTORY_NO_OPEN) openBrowser(url(server));
      console.log(`sf-factory ready: ${url(server)}`);
      if (flags.json) console.log(JSON.stringify(supervisor, null, 2));
      return;
    }
    case "next":
      return next(await requireServer());
    case "done":
    case "fail": {
      const id = positional[0];
      if (!id) throw new Error(`usage: sf-factory ${cmd} <command-id>`);
      const body =
        cmd === "done"
          ? { ok: true, ...(str(flags.result) ? { result: str(flags.result) } : {}) }
          : { ok: false, error: str(flags.error) ?? "failed" };
      const record = await api<CommandRecord>(await requireServer(), "POST", routes.commandResult(id), body);
      return console.log(`Command ${record.id} marked ${record.status}.`);
    }
    case "say": {
      const text = positional.join(" ") || str(flags.text);
      if (!text) throw new Error('usage: sf-factory say "<text>"');
      const message = await api<SupervisorMessage>(await requireServer(), "POST", routes.messages, {
        text,
        level: str(flags.level) ?? "info",
        commandId: str(flags.command),
      });
      return console.log(`Posted message ${message.id}.`);
    }
    case "changes": {
      const since = Number(str(flags.since) ?? 0);
      const { changes } = await api<FileChangesResponse>(
        await requireServer(),
        "GET",
        `${routes.fileChanges}?since=${since}`,
      );
      if (flags.json) return console.log(JSON.stringify({ changes, now: Date.now() }, null, 2));
      if (!changes.length) console.log("No file changes.");
      for (const c of changes) console.log(`${new Date(c.at).toISOString()}  ${c.event.padEnd(6)}  ${c.path}`);
      return console.log(`Cursor: --since ${changes.at(-1)?.at ?? since}`);
    }
    case "status": {
      const server = await findServer();
      if (!server) return console.log("not running");
      const state = await api<SessionState>(server, "GET", routes.state);
      const count = (s: string) => state.commands.filter((c) => c.status === s).length;
      const runtime = state.project?.runtime;
      return console.log(
        `running at ${url(server)} | agent: ${state.supervisor.capabilities?.agent ?? "unregistered"} | ` +
          `pending: ${count("pending")} | claimed: ${count("claimed")} | done: ${count("done")} | failed: ${count("failed")} | ` +
          `Workers: ${Object.keys(runtime?.claims ?? {}).length} | waiting: ${runtime?.queue.length ?? 0}`,
      );
    }
    case "url":
      return console.log(url(await ensureServer()));
    case "stop": {
      const server = await findServer();
      if (server) await api(server, "POST", routes.stop).catch(() => {});
      fs.rmSync(paths.serverJson, { force: true });
      return console.log("stopped");
    }
    default:
      console.error(HELP);
      process.exit(cmd ? 1 : 0);
  }
}

// ---------- Supervisor commands ----------

async function next(server: ServerInfo) {
  const deadline = Date.now() + Number(str(flags.timeout) ?? 540) * 1000;
  while (Date.now() < deadline) {
    const wait = Math.max(1, Math.min(POLL_SECONDS, Math.ceil((deadline - Date.now()) / 1000)));
    const record = await api<CommandRecord | null>(server, "GET", `${routes.nextCommand}?wait=${wait}`);
    if (record) return console.log(flags.json ? JSON.stringify(record, null, 2) : formatCommand(record));
  }
  console.log("No command yet. Run `sf-factory next` again to keep waiting.");
  process.exit(2);
}

function formatCommand({ id, command }: CommandRecord) {
  const lines = [`Command ${id}: ${command.type}`];
  if (command.type === "worker.spawn") {
    const how = command.mode === "thread" ? "a new top-level thread" : "a subagent";
    lines.push(
      `Story: ${command.storyKey}  Stage: ${command.stageId}  Worker: ${command.workerId}  Mode: ${command.mode}` +
        `${command.agent ? `  Agent: ${command.agent}` : ""}${command.model ? `  Model: ${command.model}` : ""}`,
      `Worktree: ${command.worktree.path} (branch ${command.worktree.branch})`,
      "",
      `Spawn a Worker as ${how} working in that worktree, with this brief as its prompt:`,
      "----- BEGIN WORKER BRIEF -----",
      command.brief.trimEnd(),
      "----- END WORKER BRIEF -----",
      "",
      `Once the Worker is running: sf-factory done ${id} --result "<thread or agent id>"`,
      `If it cannot be spawned: sf-factory fail ${id} --error "<reason>"`,
    );
    return lines.join("\n");
  }
  lines.push(
    command.text,
    "",
    `When finished: sf-factory done ${id} --result "<short summary>"`,
    `If it cannot be done: sf-factory fail ${id} --error "<reason>"`,
  );
  return lines.join("\n");
}

// ---------- Server lifecycle ----------

async function serve() {
  fs.mkdirSync(paths.runtime, { recursive: true });
  const dev = Boolean(flags.dev);
  const token = str(flags.token) ?? crypto.randomBytes(16).toString("hex");
  const uiDir = str(flags["ui-dir"]) ?? path.join(path.dirname(SCRIPT), "..", "assets", "ui");
  const store = new Store(root, paths.sessionJson);
  const service = createOnlineService(store, { root, sf: SF_COMMAND });
  const stopWatching = watchFiles(root, (changes) => {
    store.addFileChanges(changes);
    // Hand edits (and offline CLI writes) show up live; they never trigger Workers.
    if (changes.some((c) => c.path.startsWith(".sf/"))) refreshProject(store, service);
  });

  let idleTimer: NodeJS.Timeout | undefined;
  const shutdown = () => {
    stopWatching();
    const current = readServerState();
    if (current?.pid === process.pid) fs.rmSync(paths.serverJson, { force: true });
    process.exit(0);
  };
  const touch = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(shutdown, IDLE_SHUTDOWN_MS);
  };

  const app = createApp({ store, service, token, uiDir: dev ? null : uiDir, onRequest: touch, onStop: shutdown });
  const server = await listen(app, Number(str(flags.port) ?? 0));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const info: DevServerInfo = { port, token, pid: process.pid, ...(dev ? { uiBase: "http://localhost:5173" } : {}) };
  fs.writeFileSync(paths.serverJson, JSON.stringify(info));
  touch();
  const sweep = () => {
    if (service.hasProject()) service.sweep().catch((err) => console.error(`sf-factory: sweep failed: ${err.message}`));
  };
  setInterval(sweep, SWEEP_MS);
  // A restarted server with a known Supervisor runs the triggers queued while it was down.
  if (store.state.supervisor.capabilities && service.hasProject()) await service.drainPending();
  // In dev there may be no Supervisor, so only the idle timeout applies.
  if (!dev) {
    const startedAt = Date.now();
    setInterval(() => {
      const { supervisor, commands, project } = store.state;
      const busy =
        supervisor.listening ||
        commands.some((c) => c.status === "claimed") ||
        Object.keys(project?.runtime.claims ?? {}).length > 0;
      const lastSeen = Math.max(supervisor.lastSeenAt ?? 0, startedAt);
      if (!busy && Date.now() - lastSeen > SUPERVISOR_HEARTBEAT_MS) shutdown();
    }, HEARTBEAT_CHECK_MS);
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  if (dev) console.log(`sf-factory API on http://127.0.0.1:${port} | UI: ${url(info)} | project: ${root}`);
}

function url(server: DevServerInfo) {
  return uiUrl(server, server.uiBase);
}

function readServerState(): DevServerInfo | null {
  try {
    return JSON.parse(fs.readFileSync(paths.serverJson, "utf8")) as DevServerInfo;
  } catch {
    return null;
  }
}

async function findServer(): Promise<DevServerInfo | null> {
  const s = readServerState();
  if (!s) return null;
  try {
    await api(s, "GET", routes.state);
    return s;
  } catch {
    return null;
  }
}

async function requireServer() {
  const s = await findServer();
  if (!s) throw new Error("the sf-factory server is not running; run `sf-factory start` first");
  return s;
}

async function ensureServer() {
  const existing = await findServer();
  if (existing) return existing;
  fs.mkdirSync(paths.runtime, { recursive: true });
  fs.rmSync(paths.serverJson, { force: true });
  // execArgv keeps loaders such as tsx when running from source.
  const child = spawn(process.execPath, [...process.execArgv, SCRIPT, "serve", "--project", root], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    const s = await findServer();
    if (s) return s;
  }
  throw new Error(
    "could not start the sf-factory server (if a sandbox blocks localhost networking, rerun with escalated permissions)",
  );
}

function openBrowser(target: string) {
  const [bin, args] =
    process.platform === "darwin"
      ? ["open", [target]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", target]]
        : ["xdg-open", [target]];
  try {
    spawn(bin, args, { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  } catch {
    // The URL is printed either way.
  }
}

// ---------- Utilities ----------

function parseArgs(argv: string[]) {
  const flags: Flags = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const [key, inline] = a.slice(2).split(/=(.*)/s);
    const nextArg = argv[i + 1];
    let value: string | boolean;
    if (inline !== undefined) value = inline;
    else if (BOOLEAN_FLAGS.has(key!) || nextArg === undefined || nextArg.startsWith("--")) value = true;
    else value = argv[++i]!;
    if (REPEATABLE_FLAGS.has(key!)) flags[key!] = [...((flags[key!] as string[] | undefined) ?? []), String(value)];
    else flags[key!] = value;
  }
  return { cmd: positional.shift(), positional, flags };
}

function str(v: Flags[string] | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
