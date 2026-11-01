---
title: Expose machine placement controls and validate the complete scheduling workflow
stage: done
dependsOn:
  - DEV-7
  - DEV-9
  - DEV-10
  - DEV-11
branch: sf/DEV-12
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/27
requires_validation_hil: false
review_rounds: 1
requires_review_hil: false
---
## Scope amendment — user decision, 2026-10-31

This amendment overrides conflicting requirements below. DEV-11 now appends selected-machine instructions to the Worker launch request. T3/the underlying harness owns actual machine handling. sf is not implementing remote discovery, a remote adapter, remote machine preparation/cleanup, scoped network transport or real cross-machine lifecycle certification.

Retain applicable placement controls, persistence, policy/capacity integration and existing reservation safeguards. Reconcile this Story's older refinement before development. Acceptance verifies that selecting "Use X Machine" reaches the outgoing launcher request as explicit instructions, preserving required/preferred intent. Show requested placement separately from any harness-confirmed execution; do not invent remote status or links. Missing remote APIs or a real remote test target are not sf integration prerequisites.

DEV-11 remains a dependency. The previous body/refinement below is historical planning where it conflicts with this amendment.

## Outcome
Complete DEV-7's end-to-end feature: users configure local/remote capacities and order, set Story overrides, and inspect routing/queue/recovery. Depends on all DEV-7 implementation follow-ups. DEV-7 retains the original full outcome and acceptance criteria as the feature reference; this Story owns final verification of every original criterion together.

## Acceptance Criteria
- [ ] Project configuration controls and CLI expose machines, capacities, mappings, enabled state and ordered preference; Story editor and CLI expose inherit/local-only/required remote/preferred remote with explicit clearing. Changes persist and share service validation online/offline; unknown IDs and invalid capacities are actionable. Prevent removing referenced machine identities without resolving references; allow disabling them so pinned Stories wait clearly.
- [ ] Status/CLI and relevant UI show effective policy, assigned machine, used/max capacity (including unknown reservations), queue/unavailability/failure reasons and correct task/thread links scoped to their owning environment. Avoid presenting remote IDs as local t3-thread links without verified support.
- [ ] Override changes affect only not-yet-reserved launches; running reservations retain assignment. Capacity changes do not terminate running Workers. Required targets never silently fall back.
- [ ] Validate original DEV-7 acceptance criteria as one checklist: legacy maxConcurrentWorkers, exact 4+2+2 scheduling across Boards under concurrent requests, eligible FIFO, override persistence/clear, cap reduction, authoritative remote lifecycle and Stage handoff, reservation reclamation/unknown occupancy, cancellation/timeout, restart/reconnect/duplicate prevention, explicit compatibility failures and stale Worker rejection.
- [ ] Include focused CLI/service/UI coverage and screenshots/manual verification for Story editor/status. Run the real linked-environment lifecycle on an explicitly configured compatible test environment and record versions, target identity, published branch/head, task links and authoritative Story mutations. Fake adapters alone cannot pass the full feature.
- [ ] Document setup, compatibility gate and version evidence, project-scoped quotas, one environment per machine limitation, fallback order, overrides, authentication and safe failure/recovery. Unsupported/non-T3 installations retain local execution with visible remote-unavailable reasons.

## Touch Points
src/cli/main.ts, src/cli/story.ts, src/model/api.ts, src/web/components/StoryEditor.tsx, Project configuration/status screens, src/server/project/service.ts, README.md, docs/specs/01-core-function.md, skills/sf/references/commands.md and relevant CLI/HTTP tests.

## Out of Scope
Host-wide quotas across sf Projects, several independent environments sharing one physical host quota, CPU-based balancing, provisioning and moving running Workers.

## Dependency Keys

Implement after DEV-7, DEV-9, DEV-10 and DEV-11. Sequence: DEV-7 → DEV-9 → DEV-10 → DEV-11 → DEV-12. These are sequencing requirements in the body, not an automatic sf scheduling dependency. Keep this Story in Backlog until its dependencies are delivered and it is refined.

## Refinement

Re-refined 2026-10-31 after DEV-7, DEV-9, DEV-10 and DEV-11 reached Done (merged to main at 0239e08), applying the 2026-10-31 scope amendment. The older refinement is replaced. Remote discovery, adapters, transport and a real cross-machine lifecycle run are out; the harness owns machine handling.

### Outcome

Users can configure machine scheduling, set each Story's placement, and see what sf requested, all without hand-editing `.sf` files. Specifically:

- configure the Project's scheduling policy (legacy `maxConcurrentWorkers`, or local capacity, remote machines and ordered preference) from the CLI and a Project Settings screen
- set Story placement (inherit / local-only / required X / preferred X) from the CLI and the Story editor
- see per-machine used/max, queue wait reasons and the machine sf requested for each Story's current execution

The outgoing `worker.spawn` request carries "Use X Machine" instructions with required/preferred intent intact. A committed verification record maps every original DEV-7 criterion to evidence or to the amendment that retired it.

### What already exists (do not reimplement)

- `src/model/placement.ts`: `validateScheduling`, `parsePlacement`/`validatePlacement`, `normalizePlacementPolicy`, `selectPlacement`. Service create/update and HTTP already accept `placement` (omission preserves, `null`/inherit clears).
- `machineRequest` plus the brief's `## Machine Placement` section (DEV-11); `sf next` prints the request.
- The execution ledger, `GET /api/executions`, and `sf execution list|show|reconcile|cancel` (DEV-10). Queue entries carry `wait.reasons`. StoryCard already shows wait reasons and unknown occupancy.
- `sf project show|set` and `GET/PATCH /api/project/settings` → `service.updateProject` (models only today). No scheduling write path exists; scheduling is only hand-editable.

### Scope

In:
- the scheduling config write path, with reference checks, through the existing project settings interface
- Story placement CLI flags and editor control
- placement and machine information in CLI and web status
- a Project Settings scheduling section
- docs and the verification record

Out:
- remote discovery, adapters, preflight, transport, preparation or cleanup
- certifying remote execution, and a real remote lifecycle run
- scheduler or ledger redesign
- moving running Workers, host-wide quotas, CPU balancing
- the web execution list with reconcile/cancel controls (split to DEV-24)

### Acceptance Criteria

- [ ] **Config API.** `UpdateProjectRequest` gains `scheduling?: SchedulingConfig | null` and `maxConcurrentWorkers?: number`.
  - `service.updateProject` validates them with `validateScheduling`/`validateCapacity` inside the existing `mutate`. A supplied `scheduling` replaces the whole value; `null` removes it. Omitted keys are unchanged; there are no deep merges.
  - Writes are atomic, preserve unrelated config, and trigger the same dispatch/queue drain as other runtime-affecting mutations, so a raised cap launches queued work and a lowered cap only stops new reservations.
  - `ProjectSettingsResponse` adds the normalized policy (`normalizePlacementPolicy`) and current per-machine usage.
- [ ] **Reference checks** run in the same mutation. Reject, with an error naming each reference and how to resolve it:
  - removing a remote ID still referenced by any Story's required/preferred placement (any Board) or by an occupying execution
  - changing `environmentId` or `project.projectId`/`repository` under an ID that an occupying execution holds
  - setting `scheduling: null` while any of the above exist

  Allowed: renames, capacity changes (including 0 or below current usage), enable/disable, and order changes. Disabling a referenced remote is allowed, and its required Stories wait with the existing `disabled` reason. Nothing here clears unknown occupancy or a branch fence.
- [ ] **CLI config.** `sf project set` accepts `--scheduling-file <json-path>` (the file holds a complete scheduling object or `null`) and `--max-workers <n>`, alongside the existing model flags. Online it uses PATCH `/api/project/settings`; offline it uses the same service call.
  - Malformed JSON and invalid fields give actionable errors (the field path from `validateScheduling`).
  - `sf project show` text lists the mode (legacy N or scheduling), the local cap, each remote (id, name, environment/project/repository, enabled, cap, used) and the order. `--json` returns the response.
  - Update `PROJECT_HELP`.
- [ ] **CLI placement.** `sf story create|update` accept `--placement inherit|local-only|required|preferred` and `--machine <remote-id>`.
  - required/preferred need `--machine`; inherit/local-only reject it; `--machine` without `--placement` is an error.
  - On update, omitting the flag preserves placement; `--placement inherit` sends `null`.
  - `sf story show` prints `placement: <mode>[ <machine>]` when it is set. It also prints the current execution's reserved machine, status and Supervisor-reported task/thread as plain text, labelled as requested/reported. `story list` tags show the machine when one is reserved. Help is updated.
- [ ] **Status.** `sf status` adds per-machine `used/max` (from the ledger's usage, so it may exceed a lowered cap) and keeps its existing fields. Add `sf status --json` returning `{ server, commands, claims, occupying, waiting, machines }`. When the server is not running, `sf status` keeps printing `not running`.
- [ ] **Project Settings UI.** Add a Scheduling section to a Project Settings entry reachable from the sidebar, separate from Board Settings. It may host the existing `ModelSettings`.
  - Legacy mode edits `maxConcurrentWorkers`. Enabling scheduling shows local capacity, remote rows (id, name, environmentId, projectId, repository, enabled, capacity) with add/remove, and an ordered list of machine IDs including explicit `local`, with keyboard-operable add/remove and move up/down.
  - Copy explains that per-machine limits replace the legacy total once scheduling is on.
  - Server validation and reference errors appear in the existing error banner without discarding the form. Disabling scheduling sends `scheduling: null`.
- [ ] **Story editor placement.** A built-in Placement control (not a custom field) offers Inherit / Local only / Required / Preferred, with a machine select only for required/preferred.
  - Disabled remotes are listed with a "(disabled)" label. A persisted target that is no longer configured shows as unresolved and can be cleared or repointed.
  - Without scheduling, only Inherit/Local only are offered, plus the unresolved current value if one is set.
  - Placement survives unrelated edits and reloads.
- [ ] **Web status.** The sidebar Workers footer shows per-machine `used/max` when scheduling is set and keeps today's legacy display otherwise.
  - StoryCard/editor show the reserved machine for a Story's occupying execution as "Requested: X". Any Supervisor-reported task/thread appears as plain text.
  - Do not build t3-thread links for remote IDs, and do not invent remote status.
- [ ] **Launch request.** Tests drive the service end to end: configure a remote through `updateProject`, set placement through the CLI/service, and trigger a spawn. The resulting `worker.spawn` command and brief carry the `machine` request with `placement` `required` (no `localFallback`) or `preferred` (`localFallback` only when the order lists local), plus the order-chosen `default`. A placement edit after reservation leaves the running execution's machine unchanged and affects only the next launch.
- [ ] **Tests** (node:test, `test/helpers.ts`/`scheduling-fixture.ts`) cover:
  - config round-trip, replace/null semantics and preservation of unrelated config
  - every reference-check rejection and the allowed edits
  - offline/online parity for `project set` and story placement flags
  - CLI flag validation errors
  - cap reduction while occupied, with no termination
  - disabled remotes making required Stories wait
  - legacy behavior unchanged

  Verify the UI in the running app (validation captures the screenshots). Run focused tests, `pnpm test` and `pnpm check`.
- [ ] **Verification record.** Commit `docs/verification/machine-scheduling.md`: a checklist of every original DEV-7 acceptance criterion, each marked pass (with the test name or observed run), unrun, or retired by the 2026-10-31 amendment (harness-owned remote lifecycle, compatibility preflight, real-target run). No retired or unrun row may be called passed. Record the dependency merge commits (DEV-7 PR #11, DEV-9 #14, DEV-10 #20, DEV-11 #26).
- [ ] **Docs.** Update README.md, docs/specs/01-core-function.md (replace "CLI/editor placement controls are deferred to DEV-12"), skills/sf/references/commands.md and docs/remote-workers.md with:
  - CLI/JSON/UI setup examples and the reference-check/disable behavior
  - legacy precedence and the Project-wide scope across Boards
  - the one-environment-per-machine limitation
  - order/fallback semantics, overrides/clear
  - that a machine request is not proof of remote execution

  Link the verification record. `.agents/skills/sf` is a symlink to `skills/sf`, so edit the canonical file.

### Touch Points

- src/model/api.ts (UpdateProjectRequest, ProjectSettingsResponse)
- src/server/project/service.ts (`updateProject`, reference checks, `showProject`)
- src/server/routes/project.ts (unchanged route, new fields)
- src/cli/story.ts (`project set/show`, story flags, `formatStory`/`formatStoryLine`, PROJECT_HELP)
- src/cli/main.ts (`status`, `--json`)
- src/web/App.tsx, components/AppSidebar.tsx, a new ProjectSettings/Scheduling component, components/ModelSettings.tsx (hosted), components/StoryEditor.tsx, components/StoryCard.tsx, api/client.ts, api/hooks.ts
- test/config.test.ts, cli.test.ts, http.test.ts, offline.test.ts, story-placement.test.ts, instructions.test.ts
- README.md, docs/specs/01-core-function.md, docs/remote-workers.md, docs/verification/machine-scheduling.md, skills/sf/references/commands.md

### Assumptions

- The old refinement's `sf project config show|set --file` and `PATCH /api/project` are dropped in favor of extending the existing `sf project show|set` and `PATCH /api/project/settings`. This keeps one supported interface. `--scheduling-file` replaces the whole scheduling value rather than accepting a partial top-level patch file.
- Queue entries don't bind a machine until reservation, so reference checks cover Story placements and occupying executions only. Pending `worker.spawn` commands always have an occupying execution.
- DEV-10's `unmapped` eligibility guard stays for hand edits; the sf write path rejects those identity changes up front.
- Execution identities from the harness (task/thread) are shown as text only. sf has no verified link contract for remote IDs.
- Screenshots and PR are the validation Stage's job; this Stage's developer verifies the UI interactively.

### Follow-ups

- DEV-24: web execution ledger view with reconcile/cancel controls (depends on DEV-12).
