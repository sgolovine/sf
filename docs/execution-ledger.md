# Worker executions: capacity, Claims and recovery

DEV-10 (2026-10-31). sf schedules Workers from a durable per-Project **execution ledger** in
`.sf/runtime/state.json` (runtime version 2). This document is the Supervisor protocol and the
operator recovery guide. Since DEV-11, a reserved remote is requested from the Supervisor's
harness with a machine request ([remote Workers](remote-workers.md)); DEV-12 adds the controls and status UI.

## Claim versus execution

A **Claim** is Story command authority. An **execution** is one launch generation: the thing that
occupies a machine slot and the Story branch. They end independently:

- Move, release, `story wait`, force-release and Claim timeout end the Claim at once. The old
  Worker's next sf command is rejected with `claim is gone`. None of them proves the Worker's
  thread or subagent stopped.
- Only correlated **terminal evidence** ends an execution and frees its capacity and branch.
  Until then the next Stage is queued with the wait reason `branch-occupied`, its worktree is not
  prepared, reused or removed, and a Done cleanup is deferred and runs once the execution ends.
- Terminal evidence for an execution whose Claim is still live also ends that Claim
  (`execution-ended`, or `spawn-failed` for `not-started`).

This deliberately tightens the earlier local behavior, where a Claim end freed its slot.

## Ledger entries

Each entry records worker/Story/Board/Stage, machine ID, sf environment and Project identities,
owning worktree path and branch, launch identity (`execution.id`, also the durable request key),
command ID, resolved agent/model, lifecycle timestamps, task/thread IDs when known, the latest
evidence, any conflict, the outstanding Supervisor attempt and retry timing.

| Status | Meaning | Occupies |
| --- | --- | --- |
| `reserved` | Capacity, Claim and branch reserved; launch command not delivered | yes |
| `launching` | The Supervisor received `worker.spawn`; a launch may exist | yes |
| `running` | The Supervisor reported the launch accepted (never completion) | yes |
| `unknown` | Launch or end unconfirmed (timeout, force-release, lost result, restart) | yes |
| `terminal` | Confirmed `completed`, `failed`, `cancelled` or `not-started` | no |

Local identities are generated once (`sfe-…` environment, `sfp-…` Project) and survive restarts
and checkout moves. Remote entries record the configured `environmentId` and `project.projectId`.
Verified adapter IDs reported by the Supervisor are kept beside sf's own, never instead of them.

## Dispatch

Under the Project mutation lock sf selects placement with DEV-9's `selectPlacement`, reserves the
slot, creates the Claim and writes the launch intent, then saves. Only after the save, outside
the lock, the intent is published to the Supervisor's command queue, deduplicated by launch
identity. A crash at any point republishes the same intent; it never creates a new identity.

- Capacity: without `scheduling`, local only at `maxConcurrentWorkers` (default 3). With
  `scheduling`, only per-machine caps. Every non-terminal entry counts, across all Boards.
  A lowered cap or cap 0 stops new reservations; running Workers are never stopped.
- Eligibility: local needs a registered Supervisor with a thread or subagent tool (an
  unregistered Supervisor keeps commands waiting, as before). Configured, enabled remotes need the
  same launch ability; the harness owns machine handling. A remote whose environment/project mapping changed while one of its executions
  is occupying is `unmapped` until that execution ends. Removing a machine never hides its
  occupying entries or their branch fences.
- Queue: oldest first (`queuedAt`, then a stable sequence number). Each drain skips entries that
  must wait (capacity, eligibility, `branch-occupied`) and continues to later eligible work,
  recording the latest wait reasons on the entry. A newer Move replaces a Story's request.
- Wakes: every mutation drains before and after its change, including placement and
  configuration edits, capability registration, results, reconciliation and startup. The
  periodic sweep and hand edits to `sf.config.json` or a `board.config.json` also drain.
- The delivery gate (`sf next` claiming a `worker.spawn`) rechecks Stage, prompt/HIL,
  dependencies, agent/model, Claim, placement and generation before and after preparing the
  worktree. A stale reservation is cancelled (`not-started`) and the request queued again.

## Supervisor protocol

`worker.spawn` now carries `execution: { id, machineId, environmentId, projectId }`.

```sh
sf done <id> --status running --task <task id> --thread <thread id>   # launch accepted
sf fail <id> --not-started --error "<reason>"                        # nothing was started
sf execution report <execution id> --status terminal --outcome completed --evidence "<what ended>"
```

`done` without `--status` is the legacy form: launch accepted, with `--result` kept as a label.
A `fail` without `--not-started` after delivery cannot prove nothing started, so the execution
becomes `unknown` and keeps its slot. Any identity included in a report must match the recorded
generation, or the report is rejected without effect. Duplicate and late results only add
structured evidence; they never restore a Claim. Results on cancelled or interrupted command
records are still kept as evidence.

sf also sends the Supervisor:

- `execution.reconcile`: look up an earlier launch by its task/thread/label, or by Worker and
  execution ID. Never launch it again. Answer with `sf done <id> --status
  running|terminal|not-started|unknown --evidence "..."` (plus `--outcome` for terminal).
- `execution.cancel`: stop the execution, then report what can be confirmed. A cancellation
  acknowledgement alone is not terminal; report `--status unknown` or `running` until it is.

Answers carry the attempt they belong to; an answer to an older attempt changes no state.

## Reconciliation

The online service issues at most one outstanding attempt per execution, at most four at once,
on every mutation (startup, reconnect, results and the 60 s sweep). Executions qualify when they
are `unknown`, or `running`/`launching` without a live Claim. The first attempt is immediate;
later ones back off from 1 minute, doubling to 30 minutes. An attempt the Supervisor never
answers expires after 10 minutes unless its command is still queued. Timestamps and attempt IDs
are persisted, so a restart does not start a burst of lookups.

On startup, before anything is dispatched, sf reconnects the ledger with the command records:
an undelivered launch is republished under its identity; a launch the Supervisor had received
(`launching`, or a claimed command now `interrupted`) becomes `unknown`. A claimed `worker.spawn`
is never redelivered after a restart.

Adapters (from the Supervisor's registered capabilities):

| | T3 Code | Other Supervisors |
| --- | --- | --- |
| Local launch | supported | supported (thread or subagent tool) |
| Remote | requested from the harness (machine request) | requested from the harness (machine request) |
| Status | by task/thread ID | only the Supervisor's own observation |
| Lookup by request ID | not declared | unsupported |
| Idempotent relaunch | unverified: never relaunched | unsupported |

Without a task, thread or label and without lookup by request ID, sf issues no automatic
lookup: the execution stays `unknown` and its `recovery` field says what is missing.

## Operator recovery

```sh
sf execution list [--all] [--json]    # occupying executions, usage, adapter support
sf execution show <execution id>      # identity, status and what sf is waiting for
sf execution reconcile <execution id> # ask the Supervisor to look it up now
sf execution cancel <execution id>    # ask the Supervisor to stop it
sf execution report <execution id> --status terminal --outcome completed|failed|cancelled --evidence "..."
sf execution report <execution id> --status not-started --evidence "..."
```

These use the authenticated API (`/api/executions`). There is no force-forget and no
elapsed-time release: only correlated evidence frees an execution. Report terminal evidence only
after checking the actual thread, subagent or task. A report that contradicts an earlier end
(for example `running` after `not-started`) occupies the slot again as `unknown` with a
`conflict` until it is reconciled.

## Migration from runtime version 1

Loading a version 1 runtime migrates it in memory; the first mutation saves version 2. IDs are
derived from persisted Worker IDs, so repeated reads agree and migrating again is a no-op.
Unknown fields are kept.

- Each live Claim becomes an occupying local execution with a generated launch identity:
  `running` when the Worker record had a thread ID (kept as its label), `unknown` without one,
  and `launching` for a spawning Claim. At startup a spawning Claim whose command is still
  pending is treated as undelivered; otherwise it becomes `unknown`.
- Ended Worker records without a live Claim stay history. Their `endedAt` only recorded the
  Claim's end and cannot prove the execution stopped; it creates no occupancy.
- Queue entries get sequence numbers in their existing order.
- Unrelated or manual threads and provider history are never counted.
