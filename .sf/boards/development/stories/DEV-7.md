---
title: Establish the remote Worker compatibility contract and preflight
stage: done
branch: sf/DEV-7
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/11
requires_validation_hil: false
requires_review_hil: false
---
## Outcome

As an sf user, I can limit concurrent Workers on my local machine and each configured remote machine, prefer remote execution with local overflow, and override placement for an individual Story.

Example: local=2, build-server=4, spare-server=2, ordered preference=[build-server, spare-server, local]. With all machines eligible, the first four Workers use build-server, the next two use spare-server, the next two use local, and further work queues. A local-only Story queues when local is full even if a remote has room.

## Research (2026-10-29)

### T3 Code

- T3 environments own their projects, threads, provider credentials, and files. An environment has a stable ID independent of its network routes. A remote project/worktree therefore needs its own mapping; the local checkout path cannot simply be sent to the remote machine. Source: [Remote architecture](https://github.com/pingdotgg/t3code/blob/main/docs/internals/remote.md).
- Current upstream documents linked environments (beta) for agent-to-agent remote work. Remote `delegate_task` runs an ordinary thread in the matching repository or an explicitly selected target project and returns results to the parent. Both machines must enable the beta and establish a link. Source: [Link another environment](https://github.com/pingdotgg/t3code/blob/main/docs/user/remote-access.md#link-another-environment).
- T3 also documents client-side automatic machine selection based on resources and preferences. That does not establish sf's deterministic concurrency guarantees or Story overrides. Source: [Balance new threads across machines](https://github.com/pingdotgg/t3code/blob/main/docs/user/remote-access.md#balance-new-threads-across-machines).
- Compatibility finding: the tools exposed to this research thread advertise local `t3_thread_launch`, `delegate_task`, and provider/model capabilities, but their advertised schemas do not explicitly expose remote environment selection or linked-environment discovery. Do not invent tool parameters or assume this installed integration matches latest upstream. Refinement must verify the actual supported remote discovery/launch/status/cancel contracts and minimum compatible T3 version. No remote thread was launched or machine linked during research.

### sf today

- `src/model/config.ts` and `src/server/project/config.ts`: one Project-wide `maxConcurrentWorkers`, default 3; no machine registry or placement policy.
- `src/server/project/service.ts`: `requestSpawn`, `drainQueue`, and `spawnNow` count all live Claims against that single limit. Claims are reserved before the Supervisor launches a Worker, which is the right place to enforce capacity atomically.
- `src/model/runtime.ts` and `src/model/commands.ts`: Claims, Worker records, queue entries, and `worker.spawn` lack machine/project identity. Worker completion reports only a free-form thread identifier.
- `prepareSpawn` creates a local Story Worktree. `src/server/project/brief.ts` embeds local absolute paths and local sf CLI commands. `src/server/services/ClientService.ts` contacts sf through loopback and a local server discovery file. These assumptions prevent a remote Worker from using the brief unchanged.
- `skills/sf/references/commands.md` directs the Supervisor to launch threads/subagents and report the identifier. Remote placement must extend that contract, rather than require the Supervisor to infer routing from natural language.

## Proposed scope and behavior

1. Add Project scheduling configuration with a local capacity and remote entries containing a display name, stable environment identity, target repository/project mapping, enabled state, and nonnegative integer capacity. Zero disables new automatic starts there. Reuse T3's established connections/links; do not store pairing credentials in committed sf configuration. Multiple routes to one environment consume the same capacity. Initially support one T3 execution environment per configured physical machine; flag multiple independent environments on one host as unsupported for shared machine limits unless a canonical machine grouping is implemented.
2. Support a deterministic ordered preference list with remote machines ahead of local. Auto placement selects the first eligible machine with a free slot. Eligibility includes reachability, permissions, compatible remote tools, project mapping, and the resolved Stage agent/model. Skip unavailable targets with a visible reason; queue when no allowed target has capacity. Reconsider waiting work when capacity/configuration/availability changes.
3. Add a built-in Story placement property, editable through CLI and Story editor: inherit Project policy, local-only, a required remote machine, or a preferred remote machine with fallback to the Project order. Clearing restores inheritance. A required target never silently falls back. Overrides affect placement, never bypass capacity. Changes apply to the next not-yet-reserved launch; already reserved or running Workers retain their assignment.
4. Reserve capacity and bind a machine under sf's existing mutation lock before emitting a spawn command. Count spawning and active sf Workers across all Boards in this sf Project. Historical/idle T3 conversations and unrelated manual threads do not count. This first version is not a host-wide quota shared by separate sf Projects; document that boundary. Preserve the existing one-live-Claim-per-Story guarantee.
5. Extend spawn commands, Claims, Worker records, and results with execution environment/project identity, target worktree/branch, launch identity, and task/thread identifiers as appropriate. Keep scheduling policy in sf; isolate T3-specific discovery and launch details at the Supervisor/adapter boundary. Non-T3 supervisors retain local execution and report unsupported remote configuration explicitly.
6. Prepare the repository and Story branch on the selected machine, using the authoritative published branch/head when handing work between machines or Stages. Never pretend uncommitted local changes are present remotely. Retain existing branch isolation and clean/pushed worktree cleanup guarantees, performing cleanup on the owning machine and surfacing unreachable/dirty worktrees.
7. Provide an authenticated way for remote Workers to read/update/move/release Stories in the authoritative sf Project, through a supported CLI transport or a Supervisor-mediated command channel. Do not create an independent remote `.sf` backlog or pass local loopback URLs/paths as though remotely accessible. Preserve worker identity, Claim validation/refresh, HIL behavior, complete brief instructions, and available Story resources. Remote commands must fail once their Claim ends.
8. Show effective placement policy, assigned machine, per-machine used/max slots, and queue/failure reasons in status/CLI and the relevant UI. Configuration changes and Story overrides are validated consistently online and offline.

## Acceptance criteria

- [ ] Existing configurations without machine scheduling preserve current local-only behavior and `maxConcurrentWorkers`. Define migration/precedence explicitly: when machine scheduling is configured, per-machine limits replace the legacy total cap, so its default 3 does not accidentally cap all machines together. Reject ambiguous configuration or document a deliberate optional overall cap.
- [ ] The 4+2 remote and 2 local example dispatches exactly as described, across multiple Boards, without exceeding any cap under simultaneous requests. A queued Story pinned to a full/unavailable machine does not block later Stories eligible for free machines; preserve oldest-first ordering among eligible Stories.
- [ ] Each Story override works from UI and CLI, survives reload/restart, respects limits, and clearing it restores Project defaults. Unknown machine references and invalid capacities produce actionable errors. Lowering a cap below current usage starts nothing further there until usage falls; it does not kill running work.
- [ ] A real compatible linked T3 environment can run a Worker in its own correct project/worktree, use the configured agent/model, update the authoritative Story, and move/release it. The UI records the correct remote identity and task/thread link. The next Stage can safely use the published Story branch on its selected machine.
- [ ] Release, Move, confirmed spawn failure, cancellation, and Claim timeout reconcile reservations and wake eligible queued work without leaking slots. A timeout or force-release must not make an unconfirmed still-running external Worker disappear from machine capacity: confirm termination or retain an explicit occupied/unknown reservation until reconciliation. Stale Workers cannot mutate Stories.
- [ ] Restart/reconnect preserves reservations and reconciles external task identity before retrying uncertain launches. A lost launch response cannot produce duplicate Workers. Temporary disconnect does not automatically launch a second copy locally. Definitively failed launches can release capacity and retry according to placement policy; a required remote never falls back.
- [ ] Unsupported T3 versions/tools, disabled linked-environment beta, missing links, revoked access, missing projects/models, and remote preparation failures appear as explicit unavailable/failed reasons. Auto Stories can use another eligible target; required-target Stories wait or fail clearly. Do not attempt credential discovery from private T3 databases.
- [ ] Focused scheduler/service/CLI tests cover routing, boundaries, eligible FIFO, override persistence, reservations, lifecycle recovery, compatibility, and legacy configuration. Validate the Story editor/status UI and one end-to-end remote Worker lifecycle on an explicitly configured compatible test environment. Document setup, capacity scope, fallback, and recovery.

## Refinement decisions and implementation sequence

Treat this as a feature Story requiring refinement before development. First prove remote discovery/launch/status/cancel and authoritative sf command transport against the actual installed T3 integration; record exact APIs and version prerequisites. Then implement configuration and a pure placement selector, machine-aware reservations/runtime recovery, remote worktree/brief transport, and UI/CLI controls. Split into linked implementation Stories during refinement if necessary, keeping the end-to-end outcome and acceptance criteria together.

Recommended initial boundaries: active sf Worker capacity per machine within this Project; explicit ordered preferences rather than CPU-based balancing; preconnected machines and preexisting repository mappings; no automatic migration of running Workers, provisioning of servers, or copying uncommitted work. A true shared quota across independent sf Projects or multiple T3 servers on one physical host is follow-up work unless the user expands scope.

## Refinement

### Outcome

DEV-7 is the first reviewable slice: publish the verified T3 remote-execution compatibility contract, the authoritative sf command transport decision, and a reproducible preflight/runbook. This is a documentation/architecture investigation PR; it does not enable machine scheduling. The author's full feature description and acceptance criteria above are unchanged and remain the feature reference. DEV-12 owns their final end-to-end verification after DEV-9, DEV-10 and DEV-11. Completing this slice alone does not deliver the original feature.

### Scope

In: a repository-owned compatibility report in `docs/` (suggest `docs/remote-workers.md`), an ADR for execution/authoritative command boundaries, and sf Supervisor skill guidance for checking capabilities before any future remote launch. Inventory the actual installed public tool contracts, distinguish local from remote support, record observed versions, and document explicit unavailable reasons and safe recovery. Design a narrowly scoped authoritative Worker command channel using supported APIs; record which pieces require sf implementation and which require T3 support. The report must make the subsequent implementation Stories buildable without fabricated remote APIs.

Out: scheduling configuration, selector, Story placement persistence/controls, reservation implementation, remote preparation/transport implementation, credentials/pairing, provisioning, and production remote launches. These belong to DEV-9 through DEV-12. Do not launch a test Worker without an explicitly configured compatible linked target. An unsupported installed integration is a valid, documented negative preflight result for this slice; it cannot satisfy remote lifecycle acceptance for DEV-11/DEV-12.

### Acceptance Criteria

- [ ] Commit the capability/compatibility report and ADR, with date, exact tested server identity/version, public API/schema evidence and repository source references. Separate observed, upstream-documented, proposed and unverified behavior. Do not claim a minimum compatible release from version numbering alone; if none can be established, record minimum version as unverified and require positive feature/API checks.
- [ ] Cover stable environment identity and linked-target discovery; link/beta/access state; target project/repository mapping; provider/model/options availability; remote launch with stable idempotency identity; remote status/cancel/terminal acknowledgement; restart/reconnect/lost-response reconciliation; target worktree binding/preparation/cleanup; correct remote task/thread links. For every operation list the exact supported tool/arguments/result identities, or explicitly mark it unavailable/unverified. Do not use permissive unknown-key schemas as evidence of support.
- [ ] Capture a reproducible read-only preflight for the installed integration. On the currently observed integration the correct result is remote unavailable: neither declared remote target selection nor linked-environment discovery is exposed. Local execution remains supported. Explain how to rerun checks after an integration upgrade, and what evidence promotes a target to eligible. Never infer remote support from app name, local thread/subagent flags, or upstream documentation alone.
- [ ] Specify the authoritative Worker command channel (read/update/create/move/release and Claim refresh) without forwarding supervisor loopback paths or creating a second `.sf`. Evaluate direct authenticated CLI transport versus supported Supervisor-mediated RPC; choose a concrete implementable channel only if its prerequisites are verified. Otherwise record the precise missing contract and make resolving it a gate on DEV-11. Require Worker/Claim-scoped authentication, no broad UI token in briefs, no remote offline write fallback, stale Claim rejection and unchanged HIL/resource semantics.
- [ ] Define the sf/adapter responsibility boundary for DEV-9/10/11: sf chooses placement and durably reserves before dispatch; adapter reports eligibility and verified external identity/status; no network call under the mutation lock; Claim invalidation is distinct from external occupancy; uncertain launches/termination retain occupancy and prevent concurrent reuse of a Story branch. Record existing local expiry semantics as a behavior change needed in DEV-10, not as a guarantee already provided.
- [ ] Include a real-test checklist for discovery → selected target/model → isolated published branch/head → authoritative Story mutation → Move/release → next Stage → terminal reconciliation/cleanup, plus negative cases (missing link/beta/access/project/model, preparation failure, stale Claim, lost response, disconnect and cancellation). An unrun checklist is labelled unrun. DEV-11/12 must run it on a configured compatible remote; fake adapters cannot certify compatibility.
- [ ] Update `skills/sf/SKILL.md` and/or its command reference to state the evidence required for future remote dispatch while preserving current local launch instructions. Verify every named sf command and link against source/help. No runtime behavior changes are required for this documentation slice; run applicable documentation/repository checks for its eventual PR.
- [ ] Link DEV-9 → DEV-10 → DEV-11 → DEV-12 and map the original feature criteria to these slices. DEV-12 retains a single complete feature acceptance checklist, including the exact 4+2+2 example and real remote lifecycle.

### Touch Points

- `CONTEXT.md`, `docs/specs/01-core-function.md`, `docs/adr/0001-story-writes-through-sf.md`, `docs/adr/0002-cli-first-foreground-server.md`: domain, authority and process lifetime constraints.
- New `docs/remote-workers.md` and new numbered ADR: evidence, compatibility gate, transport decision, implementation boundaries and verification runbook.
- `skills/sf/SKILL.md`, `skills/sf/references/commands.md`: Supervisor capabilities and launch/result contract documentation.
- Read as evidence: `src/model/supervisor.ts`, `src/model/config.ts`, `src/model/runtime.ts`, `src/model/commands.ts`, `src/server/services/CapabilitiesService.ts`, `ClientService.ts`, `OnlineService.ts`, `src/server/project/{config,runtime,service,brief}.ts`, `src/cli/{start,story,main}.ts` and `test/{claims,brief,worktree,sf-command,http,offline}.test.ts`. Runtime changes belong to follow-ups.

### Assumptions

- Split this large feature rather than send an unverified multi-machine implementation to development. DEV-7's title now names the first slice; the author's text above remains intact. A documented unsupported result is useful evidence and does not require a human to clarify the understandable feature goal.
- Verified on 2026-10-29 with live `t3_environment_read({})`: serverVersion `0.1.2`, environment label `thinkpad`, ID `729b1264-b961-4247-b425-94a8bb98c273`. This version string is observed, not proof all builds labelled 0.1.2 share this tool set.
- Live `orchestrator_capabilities({})` exposes local providers/models/options and appOwnedSubagents, asyncPolling, cancellation and threadManagement; it does not declare linked targets or remote execution support. The exposed tool catalog has local `t3_environment_read`, `t3_project_list`, `t3_thread_launch`, `delegate_task`, `task_status` and `task_cancel`, but no declared linked-environment discovery operation.
- The installed `delegate_task` declares `target.providerInstanceId`, `driverKind`, `model`, `options`; no declared environment/project selection fields. Its `clientRequestId` supports local retry identity. `task_status`/`task_cancel` take a `taskId` for a task owned by the current parent; their presence does not prove remote status/cancellation semantics. `t3_thread_launch` accepts local project/workspace binding, has no retry key and no declared remote environment selection. No speculative parameters or launch attempts were used.
- Upstream [remote architecture](https://github.com/pingdotgg/t3code/blob/main/docs/internals/remote.md) and [linked environments](https://github.com/pingdotgg/t3code/blob/main/docs/user/remote-access.md#link-another-environment), checked during refinement, describe beta links and remote delegation (including `target.projectId`), but this is not the advertised installed contract. Minimum compatible T3 release and real remote discovery/launch/status/cancel remain unverified. No links were created and no remote Worker was launched.
- Current `ClientService.api` hardcodes `127.0.0.1`; server discovery uses local runtime files. Existing capability detection relies on environment hints, not tool introspection. A Supervisor-mediated channel is only an alternative if public APIs support authenticated correlated Worker requests/results; narrative messages alone are not a command transport proof.
- Capacity is per sf Project across Boards, with one configured T3 environment per machine. Per-machine limits replace legacy maxConcurrentWorkers when enabled; there is no extra overall cap in v1. These product choices carry into DEV-9. Auto balancing based on CPU and cross-Project/shared-host limits remain out of scope.

### Follow-ups

- DEV-9: configuration, persisted placement model, pure deterministic selector; depends on DEV-7.
- DEV-10: atomic reservations, eligible FIFO and lifecycle/restart reconciliation; depends on DEV-9 and DEV-7's boundary contract.
- DEV-11: verified remote adapter, remote worktree/branch preparation, authenticated authoritative commands and real remote lifecycle; depends on DEV-10 and a positively verified compatible integration/test target. If unsupported, surface the concrete missing prerequisite during its refinement rather than inventing a transport.
- DEV-12: UI/CLI configuration and overrides, status/recovery visibility, setup documentation and the full original feature acceptance checklist; depends on DEV-9/10/11.

These are body-level sequencing requirements, not an sf automatic dependency feature. Follow-ups were created in Backlog and require their own refinement before development.
