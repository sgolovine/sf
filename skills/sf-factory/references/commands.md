# Commands

`node "$SF" next` prints one claimed command. Add `--json` for the full record:

```json
{
  "id": "c3",
  "status": "claimed",
  "command": {
    "type": "worker.spawn",
    "workerId": "w-1a2b3c4d",
    "storyKey": "DEV-3",
    "board": "development",
    "stageId": "in_progress",
    "mode": "thread",
    "worktree": { "path": "/abs/repo-sf-worktrees/DEV-3", "branch": "sf/DEV-3" },
    "brief": "# sf Worker Brief: DEV-3 ..."
  }
}
```

Each command must end with exactly one `done` or `fail`.

## `worker.spawn`

A Story moved into a Stage with an enabled Stage Prompt. sf has already claimed the Story for `workerId` and created the Story Worktree at `worktree.path` on `worktree.branch`. Start one Worker:

- **Prompt:** pass `brief` unchanged as the Worker's whole prompt. It holds the sf preamble with the Worker's commands, the Stage Prompt, and the Story.
- **Where:** the Worker works in `worktree.path`. If the tool takes a working directory, use that path. Otherwise the brief already tells the Worker to work there.
- **Mode `thread`:** start a new top-level thread. In T3 Code, use `t3_thread_launch`, put the brief in `message`, and use the existing worktree path. Report the returned thread id: `done <id> --result "<thread id>"`.
- **Mode `subagent`:** start a child agent you own, for example with the Claude Code Agent tool or T3 Code `delegate_task`. Run it in the background when the tool allows, so you can keep serving commands. Report `done <id> --result "<agent id or short label>"` as soon as it starts.
- **`agent` / `model`:** use them when present and your tool supports them; otherwise use your defaults.
- **Cannot spawn:** if you have neither a thread nor a subagent tool, or the tool fails, run `fail <id> --error "<reason>"`. The Story stays in its Stage, flagged as failed, and the user can retry it. Do not do the Worker's work in this thread.

`done` marks the Worker's Claim active. The Worker then changes Stories only through sf commands. Its Claim ends when it Moves or releases the Story, when the user force-releases it, or when it runs no sf command for the claim timeout. You do not need to watch it.

If `done` or `fail` prints `marked cancelled`, the user force-released the Story before the spawn finished. That is fine; nothing else is needed.

## `supervisor.instruct`

`text` is a direct instruction to you, the Supervisor. Do it, then run `done` with a short summary.

## Other commands

The server does not send other command types. If one arrives, run `fail` with `unknown command type`.
