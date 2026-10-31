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
    "brief": "# sf Worker Brief: DEV-3 ...",
    "execution": { "id": "x-5e6f7a8b9c0d", "machineId": "local", "environmentId": "sfe-…", "projectId": "sfp-…" }
  }
}
```

Each command must end with exactly one `done` or `fail`.

## `worker.spawn`

A Story moved into a Stage with an enabled Stage Prompt. sf has already claimed the Story for `workerId`, reserved a Worker slot for the launch `execution.id`, and created the Story Worktree at `worktree.path` on `worktree.branch`. Start one Worker:

- **Prompt:** pass `brief` unchanged as the Worker's whole prompt. It holds the sf preamble with the Worker's commands and HIL guidance, the resolved `briefPreamble` when present, optional `## SF.md` and `## BOARD.md` sections, then `## Stage Prompt` and `## Story`.
- **Where:** the Worker works in `worktree.path`. If the tool takes a working directory, use that path. Otherwise the brief already tells the Worker to work there.
- **Mode `thread`:** start a new top-level thread. In T3 Code, use `t3_thread_launch`, put the brief in `message`, and use the existing worktree path. Report the returned thread id: `done <id> --status running --thread <thread id>`.
- **Mode `subagent`:** start a child agent you own, for example with the Claude Code Agent tool or T3 Code `delegate_task` (pass `execution.id` as `clientRequestId`). Run it in the background when the tool allows, so you can keep serving commands. Report as soon as it starts: `done <id> --status running --task <task or agent id>` (add `--thread <child thread id>` when the tool returns one).
- **Launch request key:** where a tool takes a retry or request key, use `execution.id`. Never launch the same `worker.spawn` twice; if a launch call's response was lost, do not retry it, report what you know.
- **`agent`:** keep the existing agent selection when supported.
- **`model`:** when present, this is the explicit resolved slug (Story → current Stage → Board → Project). Pass it unchanged through a spawning tool that supports it; discover the live model catalog when necessary. Do not substitute your default or infer a slug from a label. If no supported tool can spawn that selection, run `fail <id> --error "unsupported Worker model <slug>: <reason>"` and `sf say "<reason>" --level warn` so the failure is visible. Verify the returned model when the tool exposes it. When `model` is omitted, use the Supervisor's default. The brief includes the resolved model and source for reference; it does not itself select a model.
- **Cannot spawn:** if you have neither a thread nor a subagent tool, or the tool refused before starting anything, run `fail <id> --not-started --error "<reason>"`. The Story stays in its Stage, flagged as failed, and the user can retry it. If a launch may have started (a timeout or lost response), run `fail <id> --error "<reason>"` without `--not-started`: sf keeps the slot until the execution is reconciled. Do not do the Worker's work in this thread.

Project owners can maintain optional, case-sensitive Markdown files at `.sf/SF.md` (shared by every Board's Workers) and `.sf/boards/<board-id>/BOARD.md` (shared by that Board's Workers across Stages). The Board id determines the path, not its display name or Story key prefix. These files supplement the existing resolved `briefPreamble`; sf does not expand templates or interpret instruction conflicts.

Worker Briefs contain, in order: the sf operational preamble (including commands and HIL guidance), the resolved `briefPreamble` when present, `## SF.md`, `## BOARD.md`, `## Stage Prompt`, and `## Story`. Each instruction section appears only when its file contains nonblank text, with only surrounding whitespace trimmed. Missing, empty, or whitespace-only files are omitted independently; other read errors report the failing path. Existing Projects need no migration or generated files. If an instruction read fails while deferred spawns are drained, sf reports the path and retains unfinished work for a later drain after the file is repaired. Already dispatched spawns are not replayed.

sf reads these files from the service's Project root in the Supervisor's checkout each time it composes a brief, including when concurrency-queued spawns or offline pending triggers are drained. Creation, edits, and deletion take effect on the next composition without a restart. Already composed/dispatched briefs and running Workers are unchanged. The files do not instruct the Supervisor or enable Stages, start Workers, or change Claims and HIL behavior; an enabled, nonblank Stage Prompt is still required.

`done` marks the Worker's Claim active; it means the launch was accepted, not that the work is finished. The Worker then changes Stories only through sf commands. Its Claim ends when it Moves or releases the Story, when the user force-releases it, or when it runs no sf command for the claim timeout. A Claim end does **not** free the Worker's slot or its Story branch: sf waits for evidence that the Worker's thread or subagent ended, so the next Stage never overlaps it.

**Report every Worker's end.** When you learn that a Worker's subagent or thread finished (a completion notification, `task_status`, or the thread going idle), run:

```sh
sf execution report <execution.id> --status terminal --outcome completed|failed|cancelled --evidence "<what you saw>"
```

If `done` or `fail` prints `marked cancelled`, the reservation ended before the command reached you; nothing was started and nothing else is needed. `marked interrupted` means the server restarted while you held the command; your result is still recorded as evidence.

## `execution.reconcile` and `execution.cancel`

sf asks about an earlier launch it cannot confirm: after a Claim ended, a timeout, a lost result or a restart. The command carries `execution`, `workerId`, `storyKey`, and any known `taskId`, `threadId` or `label`. **Never launch it again.**

- **`execution.reconcile`:** look the Worker up with your tools (T3 Code `task_status` or `t3_thread_read`; otherwise what you observed of your own subagents).
- **`execution.cancel`:** stop it (T3 Code `task_cancel`; otherwise your tool's stop), then check what actually happened. A cancellation request or `cancel_requested` is not an end.

Answer with one of:

```sh
sf done <id> --status terminal --outcome completed|failed|cancelled --evidence "<what you saw>"
sf done <id> --status running --evidence "<what you saw>"      # still active
sf done <id> --status not-started --evidence "<proof>"         # it never existed
sf done <id> --status unknown --evidence "<what is missing>"   # you cannot tell
```

Add `--task` or `--thread` when you learn an identity. "Not found" alone is not proof it never started: report `unknown`. Use `fail <id> --error "<reason>"` only when you could not carry out the lookup at all. See the [execution ledger](../../../docs/execution-ledger.md) for recovery.

## Remote dispatch preflight

Current `worker.spawn` commands, worktree paths and briefs are local. Keep using the local
instructions above. Neither `sf capabilities`, an app name, nor thread/subagent support proves
remote execution. Do not route today's command remotely or pass its Project path/loopback server
as though accessible on another machine.

Before a future remote adapter dispatches, require dated public API/schema evidence for stable
environment identity, linked-target discovery, beta/link/access, target project/repository and
provider/model/options; remote launch with durable retry identity; status/cancel/terminal
reconciliation; target worktree/head preparation/cleanup; correct task/thread links; and a
Worker/Claim-scoped authenticated channel to the authoritative sf Project.
Unknown-key acceptance is not proof of a supported argument. An uncertain launch retains
occupancy and branch exclusion; do not retry elsewhere on disconnect or response loss.

On the 2026-10-29 installed T3 integration (serverVersion 0.1.2), discovery and remote target
selection are not declared: report remote unavailable and preserve local operation. Recheck
after upgrades; minimum compatible release is unverified. Never inspect private T3 databases
for credentials or invent remote arguments.

The repository's [compatibility report](../../../docs/remote-workers.md) contains the reproducible
read-only preflight, exact observed declarations, transport gate and unrun real-target checklist;
it is source documentation, not bundled runtime functionality. If using an installed skill without
that report, obtain the repository documentation before assessing remote compatibility.

## `supervisor.instruct`

`text` is a direct instruction to you, the Supervisor. Do it, then run `done` with a short summary.

## Other commands

`sf execution list` shows occupying executions and what sf waits for; `sf execution show|reconcile|cancel|report <execution id>` inspect and recover one. There is no command that forgets an execution without evidence.

The server does not send other command types. If one arrives, run `fail` with `unknown command type`.

`sf story delete <KEY>` permanently deletes a Story without confirmation. Release any live Claim first. Story Worktrees, branches, and Worker history are retained; Keys are never reused. Supports `--project`, `--json`, and `--worker`.
