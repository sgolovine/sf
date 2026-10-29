---
name: sf
description: Run and drive the sf software factory through the `sf` CLI. This thread becomes the Supervisor - it checks which agent, model, and thread or subagent tools are available, starts the local sf web interface with `sf start` (a kanban of Boards, Stages, and Stories kept in .sf), and spawns a Worker with the Worker Brief whenever a Story Moves into a Stage with an enabled Stage Prompt. Use when the user asks to start sf or its UI (`sf start`), run the factory, or manage sf Boards, Stages, and Stories.
---

# sf

This thread is the **Supervisor**. The user moves Stories across Stages on a Board in the sf web interface. When a Story enters a Stage with an enabled Stage Prompt, sf queues a `worker.spawn` command, and you start a Worker for it. Run every command from the repository root, which is the Project root (`.sf` lives there).

## The CLI is the interface

Everything goes through the `sf` CLI: starting the UI, receiving commands, and reading or changing Boards, Stages, and Stories. Never start the server another way (no `node dist/...`, `pnpm dev`, or `vite`), never call its HTTP API with `curl`, and never edit Board, Stage, or Story files in `.sf/` by hand (only `.sf/sf.config.json` is edited by hand); use the matching `sf` command instead, so the running UI updates live. When unsure of a command or flag, run `sf --help` (or `sf setup --help`).

| Goal | Command |
| --- | --- |
| Start the UI and server | `sf start ...` (step 3) |
| Is it running, and where | `sf status`, `sf url` |
| Wait for the next command | `sf next` |
| Report a command | `sf done <id> --result "..."`, `sf fail <id> --error "..."` |
| Post to the UI | `sf say "<text>"` |
| Boards, Stages, Stories | `sf board ...`, `sf stage ...`, `sf story ...` ([worker-commands.md](references/worker-commands.md)) |
| Stop | `sf stop` |

## 1. Check the CLI

Run `sf --version`. It prints `sf <version>`. If `sf` is missing, or it is a different program (for example the Salesforce CLI), stop and tell the user to install sf: clone the sf repository, run `pnpm install && pnpm build`, then `pnpm link --global` or `npm i -g .`. Do not install it unless the user asks.

## 2. Check capabilities

Run `sf capabilities`. It detects the agent and app from the environment. It cannot see your model or tools, so complete it yourself:

- `agent`: your harness, e.g. `claude-code` or `codex`.
- `model`: your exact model id.
- `app`: the app around you, e.g. `t3-code`, `herdr`, or `terminal`.
- `canSpawnThreads`: true only if you have a tool that starts new top-level threads (for example T3 Code `t3_thread_launch`). Workers then run as threads.
- `canSpawnSubagents`: true only if you have a tool that runs child agents (for example the Claude Code Agent tool or T3 Code `delegate_task`). Workers run as subagents when you cannot spawn threads.

## 3. Start sf

Start sf the way a person does in a terminal, as a long-running background process of this thread:

```sh
sf start --agent <agent> --model <model> --app <app> \
  --can-spawn-threads <true|false> --can-spawn-subagents <true|false>
```

- **Claude Code:** run it with the Bash tool and `run_in_background: true`.
- **Codex:** run it in a command session and leave that session running.
- **Other agents:** use any tool that runs a command in the background and lets you read its output.

Never detach it: no `nohup`, `setsid`, `disown`, trailing `&`, `screen`, `tmux`, or service managers. sf runs in the foreground of that process and stops when this thread ends.

`sf start` creates `.sf/` if it is missing, starts the server, registers the capabilities, runs any triggers Workers queued while no server was running, opens the browser, and prints `sf ready: <url>`. Wait for that line (or for `sf status` to print `running at <url>`), then tell the user the URL once.

- `already running`: a live sf server already answers for this Project (`sf start` removes a stale one itself), possibly another thread's. Run `sf url` and `sf status`. Reuse it only if this thread started it. Otherwise ask the user before running `sf stop`, because that stops another session's server.
- If a sandbox blocks localhost networking, rerun with escalated permissions.
- If you cannot run background processes, give the user the exact `sf start ...` command to run in their own terminal, and wait for them to confirm.

If the Project has no Board yet, the user can create one in the interface, or ask you to: `sf board create Development --key DEV`. Set Stage Prompts with `sf stage set DEV <stage-id> --prompt-file <path> --prompt-enabled true`, and a Stage's HIL fields (Stories held for a human) with `--hil-flag <field-id> --hil-comment <field-id>`. See [worker-commands.md](references/worker-commands.md) for all Project commands.

## 4. Serve commands

Run these as separate commands, not in the `sf start` session. Repeat until the user tells you to stop:

1. Run `sf next` with a shell timeout of at least 10 minutes. It blocks until there is a command and prints it. Exit `2` means no command arrived; run it again.
2. Carry out the command. See [commands.md](references/commands.md). For `worker.spawn`, start the Worker and report right away; do not wait for the Worker to finish, and never do the Worker's work yourself.
3. Report the outcome: `sf done <id> --result "<outcome>"`, or `sf fail <id> --error "<reason>"`.

Use `sf say "<text>"` to post progress to the interface. Use `sf changes --since <cursor>` to see files changed since the last check. `sf status` shows the number of Workers holding Claims and Stories waiting for a Worker. Always close a claimed command with `done` or `fail`.

If a command says sf is not running, read the output of the `sf start` process, then start it again.

## 5. Stop

When the user asks to stop, run `sf stop`, or stop the background `sf start` process. sf also stops when this thread ends.
