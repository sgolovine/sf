# Commands

`node "$SF" next` prints one claimed command. Add `--json` for the full record:

```json
{
  "id": "c3",
  "status": "claimed",
  "command": { "type": "thread.spawn", "prompt": "Add dark mode", "workspace": "worktree", "branch": "feat/dark-mode" }
}
```

Each command must end with exactly one `done` or `fail`. Put anything the interface needs in `--result`, such as a new thread id or a short summary.

## `thread.spawn`

Start a new top-level thread that runs `prompt`.

- Optional fields: `title`, `model`, `workspace` (`root` or `worktree`), and `branch`.
- In T3 Code, use `t3_thread_launch`. Put the prompt in `message`. Map `workspace` to `workspaceStrategy`. Report the returned thread id.
- If you have no thread tool (`canSpawnThreads` is false), run `fail` and give that reason. Do not do the work in this thread.

## `subagent.spawn`

Run `prompt` in a child agent that this thread owns, for example with the Claude Code Agent tool or T3 Code `delegate_task`. Run `done` with a short summary of the result after the child agent finishes. If you cannot run child agents, run `fail`.

## `host.instruct`

`text` is a direct instruction to you, the host thread. Do it, then run `done` with a short summary.

## Other commands

The server does not accept other command types. If one arrives, run `fail` with `unknown command type`.
