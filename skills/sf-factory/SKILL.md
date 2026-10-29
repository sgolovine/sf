---
name: sf-factory
description: Run the sf software factory from this thread. This thread becomes the Supervisor - it checks which agent, model, and thread or subagent tools are available, starts the local sf web interface (a kanban of Boards, Stages, and Stories kept in .sf), and spawns a Worker with the Worker Brief whenever a Story Moves into a Stage with an enabled Stage Prompt. Use when the user asks to start sf, the factory, or the sf-factory skill.
---

# sf-factory

This thread is the **Supervisor**. The user moves Stories across Stages on a Board in the sf web interface. When a Story enters a Stage with an enabled Stage Prompt, sf queues a `worker.spawn` command, and you start a Worker for it. All communication goes through `scripts/sf-factory.mjs` (Node 20+, no install needed). Resolve that file to an absolute path once as `$SF`, and run every command from the repository root, which is the Project root (`.sf` lives there).

## 1. Check capabilities

Run `node "$SF" capabilities`. It detects the agent and app from the environment. It cannot see your model or tools, so complete it yourself:

- `agent`: your harness, e.g. `claude-code` or `codex`.
- `model`: your exact model id.
- `app`: the app around you, e.g. `t3-code`, `herdr`, or `terminal`.
- `canSpawnThreads`: true only if you have a tool that starts new top-level threads (for example T3 Code `t3_thread_launch`). Workers then run as threads.
- `canSpawnSubagents`: true only if you have a tool that runs child agents (for example the Claude Code Agent tool or T3 Code `delegate_task`). Workers run as subagents when you cannot spawn threads.

## 2. Start the web interface

```sh
node "$SF" start --agent <agent> --model <model> --app <app> \
  --can-spawn-threads <true|false> --can-spawn-subagents <true|false>
```

This creates `.sf/` if it is missing, starts the server, registers the capabilities, runs any triggers Workers queued while no server was running, opens the browser, and prints the URL. Tell the user the URL once. If a sandbox blocks localhost or detached processes, rerun with escalated permissions.

If the Project has no Board yet, the user can create one in the interface, or ask you to: `node "$SF" board create Development --key DEV`. Set Stage Prompts with `node "$SF" stage set DEV <stage-id> --prompt-file <path> --prompt-enabled true`. See [worker-commands.md](references/worker-commands.md) for all Project commands.

## 3. Serve commands

Repeat until the user tells you to stop:

1. Run `node "$SF" next` with a shell timeout of at least 10 minutes. It blocks until there is a command and prints it. Exit `2` means no command arrived; run it again.
2. Carry out the command. See [commands.md](references/commands.md). For `worker.spawn`, start the Worker and report right away; do not wait for the Worker to finish, and never do the Worker's work yourself.
3. Report the outcome: `node "$SF" done <id> --result "<outcome>"`, or `node "$SF" fail <id> --error "<reason>"`.

Use `node "$SF" say "<text>"` to post progress to the interface. Use `node "$SF" changes --since <cursor>` to see files changed since the last check. `node "$SF" status` shows the number of Workers holding Claims and Stories waiting for a Worker.

The server shuts itself down if this thread has not contacted it for 2 minutes, unless a `next` is waiting, a claimed command is still open, or a Worker holds a Claim. Rerun `next` promptly after each exit, and always close a claimed command with `done` or `fail`.

When the user asks to stop, run `node "$SF" stop`.
