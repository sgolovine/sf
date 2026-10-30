# Commands

`sf next` prints one claimed command. Add `--json` for the full record:

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
- **`agent`:** keep the existing agent selection when supported.
- **`model`:** when present, this is the explicit resolved slug (Story → current Stage → Board → Project). Pass it unchanged through a spawning tool that supports it; discover the live model catalog when necessary. Do not substitute your default or infer a slug from a label. If no supported tool can spawn that selection, run `fail <id> --error "unsupported Worker model <slug>: <reason>"` and `sf say "<reason>" --level warn` so the failure is visible. Verify the returned model when the tool exposes it. When `model` is omitted, use the Supervisor's default. The brief includes the resolved model and source for reference; it does not itself select a model.
- **Cannot spawn:** if you have neither a thread nor a subagent tool, or the tool fails, run `fail <id> --error "<reason>"`. The Story stays in its Stage, flagged as failed, and the user can retry it. Do not do the Worker's work in this thread.

`done` marks the Worker's Claim active. The Worker then changes Stories only through sf commands. Its Claim ends when it Moves or releases the Story, when the user force-releases it, or when it runs no sf command for the claim timeout. You do not need to watch it.

If `done` or `fail` prints `marked cancelled`, the user force-released the Story before the spawn finished. That is fine; nothing else is needed.

## `supervisor.instruct`

`text` is a direct instruction to you, the Supervisor. Do it, then run `done` with a short summary.

## Other commands

The server does not send other command types. If one arrives, run `fail` with `unknown command type`.

`sf story delete <KEY>` permanently deletes a Story without confirmation. Release any live Claim first. Story Worktrees, branches, and Worker history are retained; Keys are never reused. Supports `--project`, `--json`, and `--worker`.
