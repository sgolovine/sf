// The sf CLI. `sf setup` installs the sf skill; `sf start` runs the local
// server (Express API + web interface); the other commands let the Supervisor
// talk to it and change the Project (.sf) for the UI, the Supervisor, and
// Workers. See HELP for commands.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { type ExecutionsResponse, type ExecutionView, type FileChangesResponse, routes } from "#model/api";
import type { CommandRecord } from "#model/commands";
import { type ExecutionReport, validateExecutionReport } from "#model/execution";
import { machineUsage } from "#model/placement";
import type { SessionState } from "#model/session";
import type { SupervisorMessage } from "#model/supervisor";
import pkg from "../../package.json" with { type: "json" };
import { isRejection } from "../server/project/errors.ts";
import { resolveProjectRoot, sfPaths } from "../server/project/paths.ts";
import { CapabilitiesService } from "../server/services/CapabilitiesService.ts";
import { ClientService, type ServerInfo } from "../server/services/ClientService.ts";
import { runSetup } from "./setup.ts";
import { findOnPath, sfCommand } from "./sf-command.ts";
import { isAlive, runStart } from "./start.ts";
import { type Flags, PROJECT_COMMANDS, PROJECT_HELP, runProjectCommand } from "./story.ts";

const HELP = `sf: build and run a software factory. \`sf start\` runs the local server
(Express API + web interface); the other commands talk to it and change the
Project (.sf).

  sf setup [options]                install the sf skill for your agents (sf setup --help)
  sf capabilities                   print detected agent/app capabilities (JSON)
  sf start [capability flags]       init .sf if needed, run the server in the foreground, open the UI
  sf next [--timeout <s>]           wait for and claim the next command (e.g. worker.spawn)
  sf done <id> [--result "..."]     report a command as finished (worker.spawn: launch accepted)
  sf fail <id> --error "..."        report a command as failed (--not-started: no Worker was started)
  sf execution list | show <id>     Worker executions: identity, status, what sf is waiting for
  sf execution report <id> --status <s> --evidence "..."   correlated launch/end evidence
  sf execution reconcile <id> | cancel <id>   ask the Supervisor to look it up or stop it
  sf say "<text>" [--level warn]    post a message to the UI
  sf changes [--since <ms>]         list file changes seen by the watcher
  sf status [--json] | url | stop      status lists used/max Workers per machine
  sf --version | --help

Capability flags: --agent, --model, --app, --can-spawn-threads <bool>,
--can-spawn-subagents <bool>, --notes. Other flags: --json, --no-open,
--project <dir> (default: $SF_PROJECT, then the current directory).
Execution evidence (done, fail, execution report): --status running|not-started|terminal|unknown,
--outcome completed|failed|cancelled (terminal), --task <id>, --thread <id>, --evidence "...".
\`start\` also takes --port <n> (default: random) and --ui-dir <dir>. It runs
until Ctrl-C, SIGTERM, \`sf stop\`, or the exit of the process that started it.
\`next\` exits 0 with a command, 2 on timeout, 1 on error.

${PROJECT_HELP}`;

const POLL_SECONDS = 25;
const BOOLEAN_FLAGS = new Set(["json", "no-open", "dev", "force", "not-started", "all"]);
const REPEATABLE_FLAGS = new Set(["field", "model-option"]);

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
  if (cmd && PROJECT_COMMANDS.has(cmd))
    return runProjectCommand(cmd, positional, flags, root, await ClientService.findServer(paths.serverJson));
  switch (cmd) {
    case "capabilities":
      return console.log(JSON.stringify(CapabilitiesService.detect(), null, 2));
    case "start":
      return runStart(flags, root, SF_COMMAND);
    case "next":
      return next(await requireServer());
    case "done":
    case "fail": {
      const id = positional[0];
      if (!id) throw new Error(`usage: sf ${cmd} <command-id>`);
      const error = str(flags.error) ?? "failed";
      const execution = executionFlags(cmd === "fail" && flags["not-started"] ? error : undefined);
      const body =
        cmd === "done"
          ? { ok: true, ...(str(flags.result) ? { result: str(flags.result) } : {}), ...execution }
          : { ok: false, error, ...execution };
      const record = await ClientService.api<CommandRecord>(
        await requireServer(),
        "POST",
        routes.commandResult(id),
        body,
      );
      return console.log(`Command ${record.id} marked ${record.status}.`);
    }
    case "execution":
      return execution(await requireServer());
    case "say": {
      const text = positional.join(" ") || str(flags.text);
      if (!text) throw new Error('usage: sf say "<text>"');
      const message = await ClientService.api<SupervisorMessage>(await requireServer(), "POST", routes.messages, {
        text,
        level: str(flags.level) ?? "info",
        commandId: str(flags.command),
      });
      return console.log(`Posted message ${message.id}.`);
    }
    case "changes": {
      const since = Number(str(flags.since) ?? 0);
      const { changes } = await ClientService.api<FileChangesResponse>(
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
      const server = await ClientService.findServer(paths.serverJson);
      if (!server) return console.log("not running");
      const state = await ClientService.api<SessionState>(server, "GET", routes.state);
      const count = (s: string) => state.commands.filter((c) => c.status === s).length;
      const runtime = state.project?.runtime;
      const executions = Object.values(runtime?.executions ?? {});
      const status = {
        server: { url: ClientService.uiUrl(server), agent: state.supervisor.capabilities?.agent ?? null },
        commands: {
          pending: count("pending"),
          claimed: count("claimed"),
          done: count("done"),
          failed: count("failed"),
        },
        claims: Object.keys(runtime?.claims ?? {}).length,
        occupying: executions.filter((e) => e.status !== "terminal").length,
        waiting: runtime?.queue.length ?? 0,
        machines: state.project ? machineUsage(state.project.config, executions) : [],
      };
      if (flags.json) return console.log(JSON.stringify(status, null, 2));
      const machines = status.machines
        .map((m) => `${m.id} ${m.used}/${m.capacity ?? "?"}${m.configured && !m.enabled ? " (disabled)" : ""}`)
        .join(", ");
      return console.log(
        `running at ${status.server.url} | agent: ${status.server.agent ?? "unregistered"} | ` +
          `pending: ${status.commands.pending} | claimed: ${status.commands.claimed} | done: ${status.commands.done} | failed: ${status.commands.failed} | ` +
          `Workers: ${status.claims} | occupying: ${status.occupying} | waiting: ${status.waiting}` +
          (machines ? ` | machines: ${machines}` : ""),
      );
    }
    case "url":
      return console.log(ClientService.uiUrl(await requireServer()));
    case "stop":
      return stop();
    default:
      console.error(`sf: unknown command: ${cmd}\n\n${HELP}`);
      process.exit(1);
  }
}

// ---------- Supervisor commands ----------

/** The structured execution envelope from flags, or nothing when none were given. */
function executionFlags(notStarted?: string): { execution?: ExecutionReport } {
  const status = notStarted ? "not-started" : str(flags.status);
  const given = ["outcome", "task", "thread", "evidence"].filter((k) => str(flags[k]) !== undefined);
  if (!status && !given.length) return {};
  if (!status) throw new Error(`--${given[0]} needs --status running|not-started|terminal|unknown`);
  const report = {
    status,
    ...(str(flags.outcome) ? { outcome: str(flags.outcome) } : {}),
    ...(str(flags.task) ? { taskId: str(flags.task) } : {}),
    ...(str(flags.thread) ? { threadId: str(flags.thread) } : {}),
    ...(str(flags.evidence) || notStarted ? { evidence: str(flags.evidence) ?? notStarted } : {}),
  };
  const invalid = validateExecutionReport(report);
  if (invalid) throw new Error(invalid);
  return { execution: report as ExecutionReport };
}

async function execution(server: ServerInfo) {
  const [sub, id] = positional;
  const print = (e: ExecutionView) =>
    flags.json
      ? console.log(JSON.stringify(e, null, 2))
      : console.log(
          `${e.id}  ${e.storyKey}/${e.stageId}  ${e.machineId}  ${e.status}${e.outcome ? ` (${e.outcome})` : ""}` +
            `${e.taskId ? `  task ${e.taskId}` : ""}${e.threadId ? `  thread ${e.threadId}` : ""}${e.label ? `  ${e.label}` : ""}\n` +
            `  worker ${e.workerId}  ${e.worktree.branch}  ${e.waitingFor}`,
        );
  if (sub === "list" || !sub) {
    const list = await ClientService.api<ExecutionsResponse>(server, "GET", routes.executions);
    if (flags.json) return console.log(JSON.stringify(list, null, 2));
    const shown = list.executions.filter((e) => e.occupying || flags.all);
    if (!shown.length) console.log("No occupying executions.");
    for (const e of shown) print(e);
    return console.log(
      `usage: ${
        Object.entries(list.usage)
          .map(([m, n]) => `${m} ${n}`)
          .join(", ") || "none"
      } | adapter: ${list.support.name}`,
    );
  }
  if (!id) throw new Error(`usage: sf execution ${sub} <execution-id>`);
  if (sub === "show") return print(await ClientService.api<ExecutionView>(server, "GET", routes.execution(id)));
  if (sub === "reconcile" || sub === "cancel")
    return print(
      await ClientService.api<ExecutionView>(
        server,
        "POST",
        sub === "cancel" ? routes.executionCancel(id) : routes.executionReconcile(id),
      ),
    );
  if (sub === "report") {
    const { execution: report } = executionFlags();
    if (!report) throw new Error('usage: sf execution report <id> --status <status> --evidence "..."');
    const result = await ClientService.api<{ applied: boolean; reason?: string; execution: ExecutionView }>(
      server,
      "POST",
      routes.executionReport(id),
      report,
    );
    if (!result.applied) console.log(`Not applied: ${result.reason}`);
    return print(result.execution);
  }
  throw new Error(`unknown execution command: ${sub}`);
}

async function next(server: ServerInfo) {
  const deadline = Date.now() + Number(str(flags.timeout) ?? 540) * 1000;
  while (Date.now() < deadline) {
    const wait = Math.max(1, Math.min(POLL_SECONDS, Math.ceil((deadline - Date.now()) / 1000)));
    const record = await ClientService.api<CommandRecord | null>(server, "GET", `${routes.nextCommand}?wait=${wait}`);
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
      ...(command.machine
        ? [
            "",
            `Machine: start this Worker on ${command.machine.name} (${command.machine.id}) with your harness's machine handling,`,
            `  placement ${command.machine.placement}, ${command.machine.localFallback ? "local fallback permitted" : "no local fallback"}. The brief ends with these instructions; keep them when forwarding it.`,
          ]
        : []),
      "",
      `Spawn a Worker as ${how} ${command.machine ? "on that machine" : "working in that worktree"}, with this brief as its prompt:`,
      "----- BEGIN WORKER BRIEF -----",
      command.brief.trimEnd(),
      "----- END WORKER BRIEF -----",
      "",
      ...(command.execution ? [`Execution: ${command.execution.id} (use it as the launch request key)`] : []),
      `Once the Worker is running: ${SF_COMMAND} done ${id} --status running --task <task id> --thread <thread id>`,
      `If no Worker was started: ${SF_COMMAND} fail ${id} --not-started --error "<reason>"`,
      `When the Worker's thread or subagent ends: ${SF_COMMAND} execution report ${command.execution?.id ?? "<execution>"} --status terminal --outcome completed --evidence "<what ended>"`,
    );
    return lines.join("\n");
  }
  if (command.type === "execution.reconcile" || command.type === "execution.cancel") {
    const ids = [
      command.taskId && `task ${command.taskId}`,
      command.threadId && `thread ${command.threadId}`,
      command.label && `label ${command.label}`,
    ].filter(Boolean);
    lines.push(
      `Execution: ${command.execution.id}  Story: ${command.storyKey}  Worker: ${command.workerId}  Mode: ${command.mode}`,
      `Known identity: ${ids.join(", ") || "none (look it up by the Worker id or execution id; never launch it again)"}`,
      "",
      command.type === "execution.cancel"
        ? "Stop this Worker with your tools, then report what you can confirm."
        : "Look up this Worker with your tools. Do not launch it again.",
      `Ended: ${SF_COMMAND} done ${id} --status terminal --outcome completed|failed|cancelled --evidence "<what you saw>"`,
      `Still running: ${SF_COMMAND} done ${id} --status running --evidence "<what you saw>"`,
      `Never started: ${SF_COMMAND} done ${id} --status not-started --evidence "<proof>"`,
      `Cannot tell: ${SF_COMMAND} done ${id} --status unknown --evidence "<what is missing>"`,
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
  const server = ClientService.readServerInfo(paths.serverJson);
  if (!server) return console.log("not running");
  const asked = await ClientService.api(server, "POST", routes.stop).then(
    () => true,
    () => false,
  );
  if (!asked) {
    fs.rmSync(paths.serverJson, { force: true });
    return console.log("not running (removed stale server.json)");
  }
  for (let i = 0; i < 50 && isAlive(server.pid); i++) await sleep(100);
  fs.rmSync(paths.serverJson, { force: true });
  console.log("stopped");
}

async function requireServer() {
  const s = await ClientService.findServer(paths.serverJson);
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
