// Host-side CLI for the sf-factory skill. Runs the local server (Express API +
// web interface) and lets the host thread talk to it. See HELP for commands.

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  routes,
  type CommandRecord,
  type FileChangesResponse,
  type HostMessage,
  type SessionState,
} from "@sf/protocol";
import { detectCapabilities, resolveCapabilities } from "./capabilities.ts";
import { api, uiUrl, type ServerInfo } from "./client.ts";
import { createApp, listen } from "./server.ts";
import { Store } from "./store.ts";
import { watchFiles } from "./watcher.ts";

const HELP = `sf-factory: host-side CLI for the sf-factory skill. It runs the local server
(Express API + web interface) and lets the host thread talk to it.

  sf-factory capabilities                  print detected agent/host capabilities (JSON)
  sf-factory start [capability flags]      start the server if needed, register capabilities, open the UI
  sf-factory next [--timeout <s>]          wait for and claim the next command from the UI
  sf-factory done <id> [--result "..."]    report a command as finished
  sf-factory fail <id> --error "..."       report a command as failed
  sf-factory say "<text>" [--level warn]   post a message to the UI
  sf-factory changes [--since <ms>]        list file changes seen by the watcher
  sf-factory status | url | stop

Capability flags: --agent, --model, --host, --can-spawn-threads <bool>,
--can-spawn-subagents <bool>, --notes. Other flags: --json, --no-open,
--workspace <dir>. \`next\` exits 0 with a command, 2 on timeout, 1 on error.`;

const SCRIPT = fileURLToPath(import.meta.url);
const IDLE_SHUTDOWN_MS = 6 * 60 * 60 * 1000;
const POLL_SECONDS = 25;
const BOOLEAN_FLAGS = new Set(["json", "no-open", "dev"]);

type DevServerInfo = ServerInfo & { uiBase?: string };

const { cmd, positional, flags } = parseArgs(process.argv.slice(2));
const workspace = path.resolve(str(flags.workspace) ?? process.cwd());
const stateDir = path.join(
  os.tmpdir(),
  `sf-factory-${crypto.createHash("sha1").update(workspace).digest("hex").slice(0, 12)}`,
);
const stateFile = path.join(stateDir, "server.json");
const sessionFile = path.join(stateDir, "session.json");

try {
  await main();
} catch (err) {
  console.error(`sf-factory: ${(err as Error).message}`);
  process.exit(1);
}

async function main() {
  switch (cmd) {
    case "serve":
      return serve();
    case "capabilities":
      return console.log(JSON.stringify(detectCapabilities(), null, 2));
    case "start": {
      const server = await ensureServer();
      const host = await api(server, "POST", routes.capabilities, resolveCapabilities(flags));
      if (!flags["no-open"] && !process.env.SF_FACTORY_NO_OPEN) openBrowser(url(server));
      console.log(`sf-factory ready: ${url(server)}`);
      if (flags.json) console.log(JSON.stringify(host, null, 2));
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
      const message = await api<HostMessage>(await requireServer(), "POST", routes.messages, {
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
      return console.log(
        `running at ${url(server)} | agent: ${state.host.capabilities?.agent ?? "unregistered"} | ` +
          `pending: ${count("pending")} | claimed: ${count("claimed")} | done: ${count("done")} | failed: ${count("failed")}`,
      );
    }
    case "url":
      return console.log(url(await ensureServer()));
    case "stop": {
      const server = await findServer();
      if (server) await api(server, "POST", routes.stop).catch(() => {});
      fs.rmSync(stateFile, { force: true });
      return console.log("stopped");
    }
    default:
      console.error(HELP);
      process.exit(cmd ? 1 : 0);
  }
}

// ---------- Host commands ----------

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
  for (const [key, value] of Object.entries(command)) {
    if (key === "type" || value === undefined) continue;
    const text = String(value);
    lines.push(text.includes("\n") ? `${key}:\n${text.replace(/^/gm, "  ")}` : `${key}: ${text}`);
  }
  lines.push(
    "",
    `When finished: sf-factory done ${id} --result "<outcome, e.g. new thread id>"`,
    `If it cannot be done: sf-factory fail ${id} --error "<reason>"`,
  );
  return lines.join("\n");
}

// ---------- Server lifecycle ----------

async function serve() {
  fs.mkdirSync(stateDir, { recursive: true });
  const dev = Boolean(flags.dev);
  const token = str(flags.token) ?? crypto.randomBytes(16).toString("hex");
  const uiDir = str(flags["ui-dir"]) ?? path.join(path.dirname(SCRIPT), "..", "assets", "ui");
  const store = new Store(workspace, sessionFile);
  const stopWatching = watchFiles(workspace, (changes) => store.addFileChanges(changes));

  let idleTimer: NodeJS.Timeout | undefined;
  const shutdown = () => {
    stopWatching();
    const current = readServerState();
    if (current?.pid === process.pid) fs.rmSync(stateFile, { force: true });
    process.exit(0);
  };
  const touch = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(shutdown, IDLE_SHUTDOWN_MS);
  };

  const app = createApp({ store, token, uiDir: dev ? null : uiDir, onRequest: touch, onStop: shutdown });
  const server = await listen(app, Number(str(flags.port) ?? 0));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const info: DevServerInfo = { port, token, pid: process.pid, ...(dev ? { uiBase: "http://localhost:5173" } : {}) };
  fs.writeFileSync(stateFile, JSON.stringify(info));
  touch();
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  if (dev) console.log(`sf-factory API on http://127.0.0.1:${port} | UI: ${url(info)} | workspace: ${workspace}`);
}

function url(server: DevServerInfo) {
  return uiUrl(server, server.uiBase);
}

function readServerState(): DevServerInfo | null {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8")) as DevServerInfo;
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
  fs.mkdirSync(stateDir, { recursive: true });
  fs.rmSync(stateFile, { force: true });
  // execArgv keeps loaders such as tsx when running from source.
  const child = spawn(process.execPath, [...process.execArgv, SCRIPT, "serve", "--workspace", workspace], {
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
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const [key, inline] = a.slice(2).split(/=(.*)/s);
    const nextArg = argv[i + 1];
    if (inline !== undefined) flags[key!] = inline;
    else if (BOOLEAN_FLAGS.has(key!) || nextArg === undefined || nextArg.startsWith("--")) flags[key!] = true;
    else flags[key!] = argv[++i]!;
  }
  return { cmd: positional.shift(), positional, flags };
}

function str(v: string | boolean | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
