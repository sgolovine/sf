// The sf CLI. `sf setup` installs the sf-factory skill; `sf start` runs the local
// server (Express API + web interface); the other commands let the Supervisor
// talk to it and change the Project (.sf) for the UI, the Supervisor, and
// Workers. See HELP for commands.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  routes,
  type CommandRecord,
  type FileChangesResponse,
  type SessionState,
  type SupervisorMessage,
} from "#protocol";
import pkg from "../../package.json" with { type: "json" };
import { detectCapabilities, resolveCapabilities } from "../server/capabilities.ts";
import { api, findServer, readServerInfo, uiUrl, type ServerInfo } from "../server/client.ts";
import { isRejection } from "../server/project/errors.ts";
import { resolveProjectRoot, sfPaths } from "../server/project/paths.ts";
import { findOnPath, sfCommand } from "./sf-command.ts";
import { runSetup } from "./setup.ts";
import { isAlive, runStart } from "./start.ts";
import { PROJECT_COMMANDS, PROJECT_HELP, runProjectCommand, type Flags } from "./story.ts";

const HELP = `sf: build and run a software factory. \`sf start\` runs the local server
(Express API + web interface); the other commands talk to it and change the
Project (.sf).

  sf setup [options]                install the sf-factory skill for your agents (sf setup --help)
  sf capabilities                   print detected agent/app capabilities (JSON)
  sf start [capability flags]       init .sf if needed, run the server in the foreground, open the UI
  sf next [--timeout <s>]           wait for and claim the next command (e.g. worker.spawn)
  sf done <id> [--result "..."]     report a command as finished (worker.spawn: the thread id)
  sf fail <id> --error "..."        report a command as failed
  sf say "<text>" [--level warn]    post a message to the UI
  sf changes [--since <ms>]         list file changes seen by the watcher
  sf status | url | stop
  sf --version | --help

Capability flags: --agent, --model, --app, --can-spawn-threads <bool>,
--can-spawn-subagents <bool>, --notes. Other flags: --json, --no-open,
--project <dir> (default: $SF_PROJECT, then the current directory).
\`start\` also takes --port <n> (default: random) and --ui-dir <dir>. It runs
until Ctrl-C, SIGTERM, \`sf stop\`, or the exit of the process that started it.
\`next\` exits 0 with a command, 2 on timeout, 1 on error.

${PROJECT_HELP}`;

const POLL_SECONDS = 25;
const BOOLEAN_FLAGS = new Set(["json", "no-open", "dev", "force"]);
const REPEATABLE_FLAGS = new Set(["field"]);

const argv = process.argv.slice(2);
const { cmd, positional, flags } = parseArgs(argv);
const root = resolveProjectRoot(str(flags.project), process.env, process.cwd());
const paths = sfPaths(root);
// The command line that runs this sf, for Worker Briefs and command hints.
const SF_COMMAND = sfCommand({
  script: fileURLToPath(import.meta.url),
  execPath: process.execPath,
  env: process.env,
  which: (bin) => findOnPath(bin, process.env.PATH),
});

try {
  await main();
} catch (err) {
  console.error(`sf: ${(err as Error).message}`);
  process.exit(isRejection(err) ? 3 : 1);
}

async function main() {
  // setup has its own flags.
  if (cmd === "setup") return runSetup(argv.slice(1));
  if (argv[0] === "--version" || argv[0] === "-v") return console.log(`sf ${pkg.version}`);
  if (!cmd || argv[0] === "--help" || argv[0] === "-h") return console.log(HELP);
  if (flags.worker !== undefined && !str(flags.project))
    throw new Error("--worker needs --project <abs path> (the Supervisor's checkout)");
  if (cmd && PROJECT_COMMANDS.has(cmd)) return runProjectCommand(cmd, positional, flags, root, await findServer(paths.serverJson));
  switch (cmd) {
    case "capabilities":
      return console.log(JSON.stringify(detectCapabilities(), null, 2));
    case "start":
      return runStart(flags, root, SF_COMMAND);
    case "next":
      return next(await requireServer());
    case "done":
    case "fail": {
      const id = positional[0];
      if (!id) throw new Error(`usage: sf ${cmd} <command-id>`);
      const body =
        cmd === "done"
          ? { ok: true, ...(str(flags.result) ? { result: str(flags.result) } : {}) }
          : { ok: false, error: str(flags.error) ?? "failed" };
      const record = await api<CommandRecord>(await requireServer(), "POST", routes.commandResult(id), body);
      return console.log(`Command ${record.id} marked ${record.status}.`);
    }
    case "say": {
      const text = positional.join(" ") || str(flags.text);
      if (!text) throw new Error('usage: sf say "<text>"');
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
      const server = await findServer(paths.serverJson);
      if (!server) return console.log("not running");
      const state = await api<SessionState>(server, "GET", routes.state);
      const count = (s: string) => state.commands.filter((c) => c.status === s).length;
      const runtime = state.project?.runtime;
      return console.log(
        `running at ${uiUrl(server)} | agent: ${state.supervisor.capabilities?.agent ?? "unregistered"} | ` +
          `pending: ${count("pending")} | claimed: ${count("claimed")} | done: ${count("done")} | failed: ${count("failed")} | ` +
          `Workers: ${Object.keys(runtime?.claims ?? {}).length} | waiting: ${runtime?.queue.length ?? 0}`,
      );
    }
    case "url":
      return console.log(uiUrl(await requireServer()));
    case "stop":
      return stop();
    default:
      console.error(`sf: unknown command: ${cmd}\n\n${HELP}`);
      process.exit(1);
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
  console.log(`No command yet. Run \`${SF_COMMAND} next\` again to keep waiting.`);
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
      `Once the Worker is running: ${SF_COMMAND} done ${id} --result "<thread or agent id>"`,
      `If it cannot be spawned: ${SF_COMMAND} fail ${id} --error "<reason>"`,
    );
    return lines.join("\n");
  }
  lines.push(
    command.text,
    "",
    `When finished: ${SF_COMMAND} done ${id} --result "<short summary>"`,
    `If it cannot be done: ${SF_COMMAND} fail ${id} --error "<reason>"`,
  );
  return lines.join("\n");
}

// ---------- Server lifecycle ----------

/** Asks the server to stop and waits up to 5s for it to exit. Never signals a pid: server.json may be stale. */
async function stop() {
  const server = readServerInfo(paths.serverJson);
  if (!server) return console.log("not running");
  const asked = await api(server, "POST", routes.stop).then(() => true, () => false);
  if (!asked) {
    fs.rmSync(paths.serverJson, { force: true });
    return console.log("not running (removed stale server.json)");
  }
  for (let i = 0; i < 50 && isAlive(server.pid); i++) await sleep(100);
  fs.rmSync(paths.serverJson, { force: true });
  console.log("stopped");
}

async function requireServer() {
  const s = await findServer(paths.serverJson);
  if (!s) throw new Error("not running for this Project; start it with `sf start` (it runs in the foreground)");
  return s;
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
