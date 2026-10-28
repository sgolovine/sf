---
name: sf-factory
description: Run the sf software factory from this thread. Checks which agent, model, and thread or subagent tools are available, starts the local sf web interface, watches the workspace for file changes, and carries out work the interface sends, such as spawning a new thread with a prompt. Use when the user asks to start sf, the factory, or the sf-factory skill.
---

# sf-factory

This thread is the **host thread**. The sf web interface sends commands, and you carry them out. All communication goes through `scripts/sf-factory.mjs` (Node 20+, no install needed). Resolve that file to an absolute path once as `$SF`, and run every command from the repository root.

## 1. Check capabilities

Run `node "$SF" capabilities`. It detects the agent and host app from the environment. It cannot see your model or tools, so complete it yourself:

- `agent`: your harness, e.g. `claude-code` or `codex`.
- `model`: your exact model id.
- `host`: the app around you, e.g. `t3-code`, `herdr`, or `terminal`.
- `canSpawnThreads`: true only if you have a tool that starts new top-level threads (for example T3 Code `t3_thread_launch`).
- `canSpawnSubagents`: true only if you have a tool that runs child agents (for example the Claude Code Agent tool or T3 Code `delegate_task`).

## 2. Start the web interface

```sh
node "$SF" start --agent <agent> --model <model> --host <host> \
  --can-spawn-threads <true|false> --can-spawn-subagents <true|false>
```

This starts the server if needed, registers the capabilities, opens the browser, and prints the URL. Tell the user the URL once. The server also watches the workspace for file changes. If a sandbox blocks localhost or detached processes, rerun with escalated permissions.

## 3. Serve commands

Repeat until the user tells you to stop:

1. Run `node "$SF" next` with a shell timeout of at least 10 minutes. It blocks until the interface sends a command and prints it. Exit `2` means no command arrived; run it again.
2. Carry out the command. See [commands.md](references/commands.md).
3. Report the outcome: `node "$SF" done <id> --result "<outcome>"`, or `node "$SF" fail <id> --error "<reason>"`.

Use `node "$SF" say "<text>"` to post progress to the interface. Use `node "$SF" changes --since <cursor>` to see files changed since the last check.

The server shuts itself down if this thread has not contacted it for 2 minutes, unless a `next` is waiting or a claimed command is still open. Rerun `next` promptly after each exit, and always close a claimed command with `done` or `fail`.

When the user asks to stop, run `node "$SF" stop`.
