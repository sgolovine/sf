# Remote Worker compatibility and preflight

Checked **2026-10-29** for DEV-7. **Result: remote unavailable; local execution remains supported.**
This report and [ADR 0003](adr/0003-remote-worker-boundaries.md) establish the gates for future work.
They do not enable scheduling or certify a remote lifecycle.

## Evidence and status vocabulary

- **Observed:** read-only calls and public tool declarations available to this Worker.
- **Upstream-documented:** current upstream documentation, not proof about the installed server.
- **Proposed:** sf requirements for DEV-9–12, not existing APIs or behavior.
- **Unverified:** requires a supported contract and, where indicated, a real configured target.

The [evidence snapshot](evidence/t3-remote-preflight-2026-10-29.json) records the selected live
responses and exact advertised declarations (including arguments and result types).
The [catalog snapshot](evidence/t3-remote-catalog-2026-10-29.json) records the exposed T3 tool names
and relevant local project response. Neither contains pairing credentials.
Tool names have the harness prefix `mcp__t3_code__`; names below omit it.
No launch, cancellation, pairing, settings change or remote Worker was attempted.

Observed server: T3 Code, label `thinkpad`, environment ID
`729b1264-b961-4247-b425-94a8bb98c273`, serverVersion `0.1.2`, Linux x64.
This identifies the tested server, not every build labelled 0.1.2.
**Minimum compatible release: unverified.** Require positive public API and feature checks,
not a version comparison, app name or permissive unknown-key schema.

The local project returned by `t3_project_list({limit:100})` was `sf`,
ID `3af2b145-fc30-4255-ad06-9fd3c6e563fe`, workspace root
`/home/sgolovine/Projects/sf`, repository canonical key `github.com/sgolovine/sf`.
This is a local mapping only.

## Installed public contract inventory

These are declared local contracts; mutating operations were inspected, not exercised.
The snapshot contains their complete optional fields and result declarations.

| Operation | Exact public call/identities | Observed limit or missing remote evidence |
| --- | --- | --- |
| Server identity | `t3_environment_read({})` → `environmentId`, `label`, `serverVersion`, `platform`, `preferences` | Reads this server only; no declared environment selector. Stability across restart was not tested. |
| Linked-target discovery | No exposed discovery operation in this thread's T3 tool catalog | Unavailable. No declared list of linked environment IDs, routes, beta, permissions or link/access state. A missing tool does not prove there are no links. |
| Project/repository mapping | `t3_project_list({cursor?,limit?})` → `projects[].id/workspaceRoot/repositoryIdentity`, `nextCursor` | Local environment only. No declared remote selection; remote repository/project mapping unverified. Page until `nextCursor === null`. |
| Provider/model/options | `orchestrator_capabilities({search?})` → `providers[].providerInstanceId/driverKind/models/options/constraints`, `canRunChildTask`, `inheritedModel/Options/ProviderInstanceId`, modes, `features` | Local catalog. Remote providers, resolved Stage model/options and remote access unverified. Search omitted models before declaring a model absent. |
| Delegated launch | `delegate_task({task,title?,clientRequestId?,target?:{providerInstanceId?,driverKind?,model?,options?},isolation?,mode?,timeoutMs?,runtimeMode?,interactionMode?,role?})` → `taskId`, `childThreadId`, `childNodeId`, `childRunId`, `providerInstanceId`, `model`, `options`, status/work state | No declared environment or project target. `clientRequestId` is the advertised local retry identity; durable remote deduplication/reconciliation remains unverified. Unknown keys in `target` are not support for `environmentId` or `projectId`. |
| Top-level launch | `t3_thread_launch({title,message?,projectId?,modelSelection?,workspaceStrategy?,runtimeMode?,interactionMode?,scratch?,attachments?})` → `threadId`, `projectId`, `runId`, `status`, `modelSelection` | Local project/workspace binding; no declared remote selector or retry key. Do not blindly repeat after response loss. |
| Status | `task_status({taskId})` → task/child identities, `status`, `workState`, `hasPendingChildRuns`, `latestTerminal*`, summary | Parent-owned delegated tasks only. Remote identity/status and restart lookup by launch key unavailable/unverified. A terminal turn alone does not prove no nested or later work remains. |
| Cancel | `task_cancel({taskId,clientRequestId?,reason?})` → `taskId`, `status` (`cancel_requested` or terminal) | Declaration stops the child and its delegated tasks; remote termination semantics unverified. `cancel_requested` is not terminal acknowledgement. Already-terminal status is not proof that all later runs stopped. |
| Worktree binding | Local `workspaceStrategy:{type:"existing_worktree",worktreePath,branch?}`, `{type:"worktree",baseRef,branch?,startFromOrigin?}` or `{type:"root",branch?}`; delegated `isolation:"worktree"` starts from parent commit | No remote preparation/cleanup contract established. Omitted top-level strategy selects project root; delegated isolation does not copy uncommitted edits. |
| Task/thread links | Local launch returns `threadId`; delegation returns `taskId` and `childThreadId`; local UI link is `t3-thread://v1/<threadId>` | No installed remote identity/link representation verified. Never synthesize a local link to a remote child using an assumed ID format. |
| Authoritative sf commands | Local CLI and loopback API only; see transport section | No verified authenticated remote command channel. |

Observed capabilities include `appOwnedSubagents`, `asyncPolling`, `cancellation` and
`threadManagement`, all true. They say nothing about remote support.
Codex and Claude instances advertise child execution; the other observed instances are disabled.
For example, local `codex/gpt-6.1-sol` advertises `reasoningEffort` values
`low, medium, high, xhigh, max, ultra` and `serviceTier` values `default, priority`.
The current inherited options are `medium/default`. These are a dated observation, not sf defaults.
Future dispatch must resolve Stage → Board → Project agent/model, query the selected target's
catalog and verify the launch result matches instance/model/options. Do not silently downgrade.

## Upstream evidence is distinct

[Remote architecture](https://github.com/pingdotgg/t3code/blob/main/docs/internals/remote.md)
describes stable environment identity, route-independent ownership and beta-gated peer links.
It describes remote task recovery and a remote-child representation differing from the installed
local result schema. These are upstream documentation claims, unverified here.

[Link another environment](https://github.com/pingdotgg/t3code/blob/main/docs/user/remote-access.md#link-another-environment)
describes linked delegation, repository matching and `target.projectId`.
Its client load balancing does not supply sf capacity guarantees.
Both pages were read on 2026-10-29 from upstream `main` (mutable references).
Neither establishes a minimum release or authorizes speculative arguments on this integration.

## Reproducible read-only preflight

Run from the actual Supervisor thread after any integration upgrade or reconnect; a different
thread can have different tools/permissions. Save dated, credential-free evidence with each result.

1. Enumerate the public tool catalog and read the argument **and result** declarations for
   identity, linked-target discovery, target capabilities/projects, launch, status, cancel,
   worktree management and any command-channel APIs. Preserve declared fields, not just names.
   In this Codex harness inspect `ALL_TOOLS` entries with the T3 prefix. If tools are lazily
   attached, make one read-only `orchestrator_capabilities({})` call before concluding absence.
2. Call `t3_environment_read({})` and `orchestrator_capabilities({})`.
   Record server ID/version, provider constraints, models/options and orchestration features.
   Do not read private T3 databases or search local files for credentials.
3. Call `t3_project_list({limit:100})`, then subsequent declared cursors as needed.
   Record only the relevant project's ID, repository identity and root.
4. Check for **declared** linked-target discovery and remote selection. On this installation
   neither exists: stop with `remote unavailable: linked-target discovery and remote target
   selection are not exposed`. Do not send unknown keys to probe launches.
5. On a future capable integration, use only its advertised read-only calls to verify the
   configured stable environment ID, beta/link/access state, reachability, repository/project
   mapping and selected provider/model/options. Record exact calls/results in a replacement
   evidence snapshot. Missing visibility is `unverified`, never `eligible`.
6. Verify authenticated authoritative command transport, durable launch-key reconciliation,
   status/cancel/terminal semantics, target worktree preparation and correct remote links.
   Read-only checks can establish prerequisites, but promotion to **eligible** additionally
   requires the real lifecycle checklist below on an explicitly configured compatible target.

To check sf's separate local hints, run `sf capabilities` and `sf --help`.
In this source checkout use `pnpm sf:dev capabilities` and `pnpm sf:dev --help`.
Those commands do not inspect T3 tools. See
[CapabilitiesService](../src/server/services/CapabilitiesService.ts) and
[Supervisor capabilities](../src/model/supervisor.ts).
Keep existing local launch instructions in the [command reference](../skills/sf/references/commands.md).
No existing sf flag enables a remote target.

### Eligibility failures and recovery (proposed adapter reasons)

These are reason categories to implement, not current sf error codes.

- Missing discovery/remote selector or incompatible result schema: unsupported integration;
  upgrade and repeat preflight. Non-T3 Supervisors support local execution and must explicitly
  report unsupported remote configuration.
- Beta disabled, missing/expired link, revoked access or route unreachable: report the precise
  observed reason (or unknown state); recheck after the user restores access. Never pair automatically.
- Missing repository/project mapping or provider/model/options: mark that target unavailable
  until configuration and target capabilities agree.
- Preparation failure, wrong head, dirty worktree or unpublished commits: retain evidence on the
  owning machine; do not launch from a guessed branch or overwrite work.
- Lost launch response, disconnect, unknown status or cancellation without terminal proof:
  retain occupied/unknown reservation and Story branch exclusion; reconcile the same launch identity.
  Do not retry on another machine. Restart/reconnect is not proof of failure.

Before reservation, auto placement may skip an unavailable target with a visible reason;
a required target waits/fails explicitly and never falls back. After an uncertain launch,
fallback waits for conclusive non-execution/termination evidence. Confirmed failure can release
capacity and reconsider policy. Availability/configuration/capacity changes wake eligible queued work.

## Authoritative Worker command transport decision

**Gate unresolved for DEV-11.** Neither evaluated channel has verified end-to-end prerequisites;
this report selects no transport as available today. [ADR 0003](adr/0003-remote-worker-boundaries.md)
sets the required security and authority boundary.

Direct authenticated CLI transport is the preferred design candidate because it can call the same
sf Story service without an agent interpreting prose. Existing
[ClientService](../src/server/services/ClientService.ts) discovers a local
`.sf/runtime/server.json` and hardcodes `127.0.0.1`;
[server](../src/server/server.ts) binds loopback, and the
[API router](../src/server/routes/index.ts) accepts one broad UI token.
The [CLI](../src/cli/story.ts) reads local Board schemas for update/create and falls back to
offline writes when no local server is found. None is a remote Worker transport.
DEV-11 needs a verified reachable authenticated route, remote CLI mode, authoritative schema
reads, scoped credential issuance/revocation and operation deduplication. No such flags/endpoints
are introduced by DEV-7. Do not put the UI token, supervisor paths or loopback URLs in a remote brief.

Supervisor-mediated RPC is an alternative only if a supported public API provides authenticated,
correlated Worker request/result delivery, recovery and caller identity. The installed task
completion summary and narrative thread messages do not establish that channel. Missing proof:
live Worker requests while a task runs, authenticated Claim binding, durable request IDs,
response correlation and retry/duplicate semantics across Supervisor restart.

Either future channel must:

- Bind authentication to authoritative Project, Worker ID, Claim generation and allowed operations.
  A worker ID in a body is not authentication. Authorize show/update/move/release for its Story;
  authorize follow-up create only on permitted Boards. No user impersonation, force-release,
  arbitrary shell RPC or remote offline write fallback.
- Support read/update/create/move/release with structured inputs/results, validated on the authority,
  including typed fields and Markdown bodies. Body-file content must be transmitted as content,
  not interpreted as a Supervisor filesystem path.
- Refresh the live Claim on accepted Worker commands; reject new requests after Move, release,
  force-release or expiry with the same `claim is gone` semantics. Replayed committed request IDs
  may return a recorded receipt but must never repeat mutation or refresh an ended Claim.
- Preserve HIL hold/wake behavior, complete brief sections, Stage prompts and required Story resources.
  Resolve repository resources at the published head; any local-only resources need an explicit
  authenticated transfer/read contract. A remote `.sf` copy is never the authority.
  Story attachments must be listed/retrieved from the authority by opaque ID through the scoped
  channel; preserve upload limits, byte integrity and safe download behavior. The existing
  attachment CLI still uses local discovery/loopback and is not a verified remote channel.
- Store secrets outside committed config and briefs, revoke Claim credentials when it ends, and
  distinguish transport failure from rejected/committed mutation for safe retries.

Current local commands verified against [CLI help/source](../src/cli/main.ts) and
[Story command source](../src/cli/story.ts) are:

```sh
sf story show <KEY> --worker <id> --project <absolute-authoritative-checkout>
sf story update <KEY> --field <id>=<value> --body-file <path> --worker <id> --project <absolute-authoritative-checkout>
sf story create <board> --title "<title>" --worker <id> --project <absolute-authoritative-checkout>
sf story move <KEY> <stage-id> --worker <id> --project <absolute-authoritative-checkout>
sf story release <KEY> --worker <id> --project <absolute-authoritative-checkout>
sf story attachment list <KEY> --worker <id> --project <absolute-authoritative-checkout>
sf story attachment get <KEY> <attachment-id> --output <new-local-path> --worker <id> --project <absolute-authoritative-checkout>
sf story attachment add <KEY> <local-file> --worker <id> --project <absolute-authoritative-checkout>
```

These examples are local only. The generated [brief](../src/server/project/brief.ts) supplies the
actual command and Project path. Current Worker scope is less restrictive than the proposed
remote authorization above; do not claim the local worker-ID check is a scoped network credential.

## sf and adapter boundary

Proposed for DEV-9/10/11; existing local behavior is described separately below.

sf owns placement policy and durable reservations across all Boards in one sf Project.
One configured T3 environment represents one machine; routes to its stable ID share capacity.
Independent environments on one physical host are unsupported for shared limits.
Unrelated manual/idle/historical threads and other sf Projects do not consume these quotas.
With no machine config preserve legacy local-only `maxConcurrentWorkers` (default 3).
When enabled, per-machine limits replace that total; v1 has no additional overall cap.
Cap zero disables new starts; lowering a cap never kills existing Workers.

The adapter owns public T3 discovery, eligibility evidence, worktree preparation, dispatch,
status/cancel and terminal evidence. It must return verified environment/project/repository,
worktree/branch/head, launch/request key, external task/thread identity and link representation,
selected provider/model/options and observed state/error. These are proposed sf data requirements,
not invented T3 parameters. Never infer target identity from a hostname or returned free-form label.

Under sf's existing mutation lock: select from a fresh eligibility snapshot, bind the machine,
reserve capacity/Story branch and persist a launch identity **before dispatch**. Do network
preparation/launch/status/cancel outside the lock; re-enter to apply results only to the matching
reservation/generation. Failures must distinguish definitely-not-started from possibly-running.
Persist request identity and results before acknowledging; after restart reconcile uncertain
launches before retry. A stable key must be proven to deduplicate across response loss and restart.

Claim validity and external occupancy are separate. Move/release/force-release/expiry revoke
Story mutation authority, but cannot prove the external Worker has stopped. Keep occupied/unknown
capacity and branch exclusion until terminal reconciliation confirms no active/nested/later runs.
The next Stage must wait for branch publication and prior execution termination before reuse.
Confirmed spawn failure/cancellation frees capacity; cancellation request alone does not.
Required targets never fallback; scan past ineligible/full pins to preserve eligible FIFO.

Source inspected initially at `81662720545c29e3d53561636bcdc739890a7cbd`, then reconciled
with `origin/main` at `3da70ca0c1d7b057d7af71a62d779071e4790d4b` before handoff:

- [service](../src/server/project/service.ts): at inspection, `mutate`, `requestSpawn`, `drainQueue`,
  `spawnNow` serialized local Claim-based capacity, `onSpawn` enqueued before Claims were saved, and
  `sweep/endClaim` freed a slot on Claim end. **DEV-10 replaced this** with the
  [execution ledger](execution-ledger.md): saved reservations before publication, occupancy
  independent of Claims, and Supervisor reconciliation.
- [runtime model](../src/model/runtime.ts), [persistence](../src/server/project/runtime.ts) and
  [commands](../src/model/commands.ts) lacked machine and durable external launch identities at
  inspection; DEV-10 added them (runtime version 2). Remote transport is still DEV-11.
- `prepareSpawn/ensureStoryWorktree` prepare locally;
  [worktree](../src/server/project/worktree.ts) retains dirty/unpushed work and deletes branches
  with `git branch -d`. DEV-11 must perform preparation/cleanup on the owning machine, verify the
  authoritative published branch/head on handoff, and surface unreachable/dirty worktrees.
  Never imply uncommitted files were copied. The merged local `removeWorktree` now runs Git
  cleanup (including fetch) inside `withLock` to serialize deletion; the proposed remote
  boundary must avoid network calls under that lock while preserving deletion safety.
- [Attachment storage](../src/server/project/attachments.ts) and the updated brief/CLI provide
  local authoritative attachment operations. DEV-11 must extend their access through the verified
  scoped transport, rather than treating a remote clone's attachment files as current authority.
- [OnlineService](../src/server/services/OnlineService.ts) enqueues local commands.
  [config](../src/server/project/config.ts) supplies the legacy cap.
  [ADR 0001](adr/0001-story-writes-through-sf.md) retains authoritative writes;
  [ADR 0002](adr/0002-cli-first-foreground-server.md) retains foreground Supervisor lifetime.
- Evidence tests: [Claims](../test/claims.test.ts), [HTTP](../test/http.test.ts),
  [offline](../test/offline.test.ts), [brief](../test/brief.test.ts),
  [command resolution](../test/sf-command.test.ts), [worktrees](../test/worktree.test.ts).
  They establish local behavior, not remote compatibility.

## Implementation sequence and feature acceptance

Body-level sequencing (sf has no automatic dependency enforcement):
**DEV-7 → DEV-9 → DEV-10 → DEV-11 → DEV-12**.
The linked Story keys can be inspected with `sf story show DEV-9` through `DEV-12`;
the dependency and ownership map is:

| Story | Deliverable and prerequisites |
| --- | --- |
| DEV-7 | This compatibility report, evidence, ADR and Supervisor preflight. Documentation slice only. |
| DEV-9 | Depends on DEV-7: validated machine configuration, precedence, persisted overrides and pure deterministic selector. |
| DEV-10 | Depends on DEV-9 and this boundary: atomic reservations, eligible FIFO, lifecycle/restart reconciliation and occupancy distinct from Claims. |
| DEV-11 | Depends on DEV-10 and positive integration/transport preflight: real adapter, target worktree/head, scoped commands and real remote lifecycle. Unsupported integration is a concrete refinement gate. |
| DEV-12 | Depends on DEV-9/10/11: UI/CLI, status/recovery/setup and final full-feature acceptance. |

DEV-12 owns this single complete checklist, corresponding in order to the original eight feature
criteria on DEV-7. All remain **unverified** by this documentation slice:

- [ ] Legacy config preserves local-only behavior and cap; machine config replaces legacy total,
  with validated unambiguous precedence and no implicit default-3 overall limit. (DEV-9)
- [ ] Across Boards under concurrent requests, preference `[build-server, spare-server, local]`
  with capacities `4,2,2` assigns first four, next two, next two exactly, then queues.
  Local-only queues when local is full despite remote space; pinned full/unavailable Stories do
  not block later eligible Stories; oldest eligible first; no exceeded cap. (DEV-9/10)
- [ ] UI and CLI support inherited, local-only, required remote and preferred remote with Project
  fallback; clearing restores defaults; persistence/restart, unknown targets, integer capacities,
  zero and cap lowering behave correctly. Overrides apply only before reservation. (DEV-9/12)
- [ ] A compatible real linked target runs the correct project/worktree, agent/model/options;
  mutates the authoritative Story, Moves/releases, records remote identities/links, and the next
  Stage safely consumes the published branch/head. (DEV-11/12)
- [ ] Move/release/confirmed failure/cancel/expiry reconcile capacity and wake eligible work;
  stale Workers cannot mutate; unknown still-running work keeps occupancy and branch exclusion.
  (DEV-10/11)
- [ ] Restart/reconnect/lost response preserve reservations and reconcile identities without
  duplicates, disconnect fallback or required-target fallback; definite failure can retry policy.
  (DEV-10/11)
- [ ] Unsupported tools/version, beta/link/access/project/model and preparation failures have
  visible reasons; auto may skip before reservation, required target waits/fails explicitly;
  no private credential discovery. (DEV-11/12)
- [ ] Focused scheduler/service/CLI coverage proves routing, boundaries, eligible FIFO, overrides,
  reservations/recovery/compatibility/legacy behavior; verify editor/status UI, real remote
  lifecycle and setup/capacity/fallback/recovery docs. Fake adapters cannot certify compatibility.
  (DEV-9–12)

## Real target test runbook — UNRUN

DEV-11 and DEV-12 must record actual commands, versions, environment/project IDs, selected
model/options, launch key/task/thread/link, branch SHA, authoritative mutation receipts,
termination and cleanup evidence. Use a disposable test Story and an explicitly configured
compatible linked target. This checklist has **not** run; this installation fails preflight.

1. Repeat read-only preflight; prove stable target identity, link/beta/access and project mapping.
2. Resolve the Stage model/options on that target; reserve there; publish an isolated Story branch
   and record its SHA. Prepare/bind the target worktree and prove the same SHA and clean state.
3. Launch once with durable identity. Verify returned environment/project/task/thread/model/options
   and open the correct remote link. Prove request retry cannot create a second Worker.
4. Through the scoped command channel, read the authoritative Story, update a field/body, create a
   permitted follow-up, and prove Claim refresh at the authority. Verify HIL and resource access.
5. Publish the result, then Move/release; prove stale credentials cannot read/mutate/refresh/create.
   Reconcile prior external termination before the next Stage reuses the branch/head on its target.
6. Confirm capacity release and eligible queue wake. On the owning machine verify cleanup preserves
   dirty/unpushed work, reports unreachable state and removes only safe worktrees/merged branches.
7. Run negative cases separately: disabled beta, missing/expired link, revoked access, unreachable
   route, missing project/repository/model/options, preparation failure, stale Claim, response loss,
   disconnect, Supervisor/server restart and cancellation (requested versus terminal).
   Observe correct reasons, retained unknown occupancy, branch exclusion and no duplicate/fallback.
8. Run the full DEV-12 checklist above, including simultaneous 4+2+2 dispatch across Boards and
   pinned-Story eligible FIFO. Record UI/CLI evidence. An adapter simulation supplements these
   tests but cannot replace the real remote lifecycle.
