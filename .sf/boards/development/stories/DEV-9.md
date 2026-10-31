---
title: Add machine scheduling configuration and a deterministic placement selector
stage: in_refinement
branch: sf/DEV-9
requires_refinement_hil: true
refinement_hil_comment: "Refinement is saved, but DEV-7 is still in_progress and
  its compatibility report/ADR have not been delivered. Options: wait for DEV-7
  (recommended), or explicitly waive the dependency. After DEV-7 is delivered,
  reconcile mapping terminology, then clear this flag to resume refinement and
  advance DEV-9. Do not start development before that sequencing gate is
  satisfied."
---
## Outcome
Implement the policy foundation for DEV-7's local/remote Worker scheduling, without enabling remote launches. Depends on DEV-7's compatibility contract. This is a policy-only slice; subsequent Stories integrate reservations, execution and UI.

## Scope
Add optional Project scheduling configuration: local capacity; remote machine IDs, display names, stable T3 environment IDs, explicit repository/project mapping, enabled flag and capacity; ordered machine preferences. No credentials, URLs as identity, CPU balancing or host-wide quotas. One configured environment per physical machine; reject duplicate environment identities and document that separate environments on one host cannot share a limit.
Add built-in persisted Story placement (inherit, local-only, required remote ID, preferred remote ID with fallback); preserve it through parsing/serialization, but defer controls to the integration Story. Define the concrete schema in the core spec. Use a pure selector taking config, placement, target eligibility and reservation usage, returning a selected machine or structured wait reasons. It must have no T3 API calls or side effects.

## Acceptance Criteria
- [ ] Without scheduling, retain local-only maxConcurrentWorkers behavior. With scheduling, per-machine limits replace the legacy total including its implicit default 3; no overall cap in v1. Document precedence for an explicitly present legacy value.
- [ ] Capacities are finite nonnegative integers; zero prevents starts. Reject unknown/duplicate preference IDs, unknown override targets, invalid mapping/identity, and duplicate environment aliases with actionable errors. Local is an explicit preference entry; a required remote does not need to appear in automatic order.
- [ ] Inherit follows order; local-only considers local alone; required considers only that remote; preferred tries that remote then deduplicated Project order. Disabled, incompatible, unreachable, unauthorized, unmapped and agent/model-ineligible targets carry explicit reasons. Capacity never overrides eligibility.
- [ ] Pure tests reproduce remote 4 + remote 2 + local 2 then queue, zero caps, cap reduction below usage, missing/disabled targets and all overrides. Persisted overrides survive reload and clearing restores inheritance. Consistent service validation online/offline.
- [ ] No remote Worker starts in this slice. Existing configuration and Story files remain readable. Update docs/specs/01-core-function.md.

## Touch Points
src/model/config.ts, src/model/story.ts (or existing Story model), src/server/project/config.ts, src/server/project/story.ts, new focused pure placement module, test/config.test.ts and focused selector/Story tests. Confirm actual file names before editing.

## Boundaries
Runtime reservations and queue integration belong to the next slice. Authentication, machine preparation and T3 execution belong to remote execution. CLI/editor/status controls and full end-to-end validation belong to final integration. Original end-to-end acceptance criteria remain in DEV-7.

## Dependency Keys

Implement after DEV-7. Sequence: DEV-7 → DEV-9 → DEV-10 → DEV-11 → DEV-12. These are sequencing requirements in the body, not an automatic sf scheduling dependency. Keep this Story in Backlog until its dependencies are delivered and it is refined.

## Refinement

### Outcome

Publish a validated, persisted scheduling policy and a deterministic pure placement selector that DEV-10 can consume. Old Projects and Stories still load. DEV-9 itself never dispatches remotely or installs the selector in the runtime queue. Development is gated on delivery of DEV-7's compatibility/boundary documentation.

### Scope

In: optional Project-only scheduling configuration, shared validation, built-in Story placement persistence and service input/output, pure selection logic, focused tests and the concrete schema/precedence in `docs/specs/01-core-function.md`.

Out: remote discovery/API calls, launch adapters, credentials, reservations, queue integration/recovery, CLI flags, editor/status controls, live remote validation and shared host quotas. These remain DEV-10/11/12. This is one reviewable policy PR; no further split is needed.

### Acceptance Criteria

- [ ] Define `ProjectConfig.scheduling?` as `{ local: { capacity: number }, remotes: [{ id, name, environmentId, project: { projectId, repository }, enabled, capacity }], order: string[] }`. `local` is the reserved local machine ID. Remote IDs use stable lowercase slugs (letters, digits, `_` and `-`, beginning with a letter), are unique and cannot equal `local`. Name, environmentId, projectId and repository are nonblank strings; identity fields are canonical IDs rather than URLs or local filesystem paths. `repository` is a stable repository identifier, not a checkout path; document its representation and that it must agree with DEV-7's verified mapping contract before implementation. No route/credential fields are introduced.
- [ ] Validate each scheduling capacity as a finite nonnegative safe integer. Require the scheduling object, local entry, remotes array, remote mappings, booleans and order to have the documented shapes; do not silently coerce malformed input or invent missing scheduling defaults. Reject duplicate remote IDs, duplicate environmentId aliases, reserved local IDs and unknown/duplicate order entries with `SfError("invalid", ...)` identifying the field/target and correction. Permit an empty order (inherit waits), omitted local in order (local is never implicitly appended), and required/preferred remotes outside order. Duplicate environment identity is rejected even when one entry is disabled. Reject scheduling in Board overrides; Stage scheduling is not supported.
- [ ] With scheduling absent, normalization presents only local, with the existing maxConcurrentWorkers value/default 3. With scheduling present, the pure policy uses only per-machine capacities; even explicitly supplied maxConcurrentWorkers is ignored by that policy and no overall cap applies. Preserve the legacy stored field for compatibility. Document that activating this policy in actual dispatch is DEV-10: until then requestSpawn/drainQueue retain their existing local-only behavior and legacy limit. Do not partially wire scheduling into dispatch or imply the 4+2+2 runtime behavior already exists.
- [ ] Add optional built-in Story `placement` to StoryData, StoryView/details, service StoryInput/StoryPatch and corresponding HTTP request types/routes as needed. Concrete union: `{ mode: "inherit" }`, `{ mode: "local-only" }`, `{ mode: "required", machineId: string }`, `{ mode: "preferred", machineId: string }`. Missing placement means inherit; patch omission preserves it; patch null or explicit inherit clears the persisted property. Required/preferred IDs must identify a configured remote (disabled is allowed but not eligible); local-only uses its own mode. Reject malformed modes/extra target combinations and unknown remote IDs on create/update. No scheduling means remote overrides are invalid; inherit/local-only remain valid.
- [ ] Extract placement from YAML frontmatter separately from custom fields, serialize it once, include it in snapshots/service responses, and preserve it through title/body/custom-field edits, Moves and reload. Reserve `placement` against Board schema/custom-field collisions and prevent fields from overwriting built-ins during serialization. Existing files without placement and unrelated unknown fields retain current behavior. Invalid/stale target references loaded after configuration edits must remain diagnosable and clearable: reject a newly supplied unknown override, but allow clearing an old one and unrelated edits; selector reports missing target without throwing. Document any existing custom field named placement as an actionable reserved-name migration conflict rather than silently discarding its value.
- [ ] Implement a focused pure placement module, with no filesystem, network, T3, clock or mutation dependency. Inputs are normalized policy/config, Story placement, per-target eligibility and occupied reservation counts. Eligibility is supplied for the resolved Stage agent/model, not discovered by the selector. Candidate order: inherit = Project order; local-only = local; required = that remote only; preferred = preferred remote followed by Project order with stable deduplication. Select the first eligible candidate whose used count is below capacity; usage equal to or above a reduced cap is full. Do not decrement usage, reserve slots, rebalance or terminate work.
- [ ] Return a discriminated result such as `{ kind: "selected", machineId }` or `{ kind: "wait", reasons: [{ machineId?, code, detail? }] }`. Define stable reason codes covering missing target, disabled, incompatible, unreachable, unauthorized, unmapped, agent-ineligible, model-ineligible, capacity and no candidates. Carry candidate reasons in deterministic candidate order; eligibility failures take precedence over capacity. Treat absent eligibility as unavailable (never assume a remote is eligible). A required remote never falls back. Missing/disabled runtime targets and stale overrides yield explicit wait reasons; malformed config is rejected by validation rather than silently accepted. Specify and test the chosen ordering when a target has multiple eligibility failures.
- [ ] Pure tests simulate successive selection by updating caller-owned usage: remote A capacity 4, remote B capacity 2, local capacity 2, order A/B/local => A,A,A,A,B,B,local,local,wait, irrespective of default/explicit legacy cap 3. Cover all override modes, stable preferred deduplication, target outside order, no candidates, zero capacities, usage above a lowered cap, disabled/missing/ineligible targets with free space, fallback, absent eligibility and deterministic output/no input mutation. No integration tests may launch real remote Workers.
- [ ] Config and Story tests cover malformed shapes, fractional/negative/nonfinite capacities, unknown/duplicate IDs, environment aliases, invalid mappings, rejected Board overrides, serialization/reload/clear, stale target recovery and legacy fixtures. Exercise the same create/update rejection and persistence through createService online and offline, plus HTTP forwarding where request types change; use shared validators rather than divergent route-only checks. Config is currently file-loaded, so test loadProjectConfig validation through both service modes; do not add an unrelated config editing API.
- [ ] Update the core spec with complete JSON/YAML examples, compatibility/precedence and deferred activation, explicit local preference, eligibility/wait results, and capacity scope: one configured T3 environment per physical machine, per sf Project across Boards; aliases cannot multiply capacity, and independent environments on one host/independent Projects cannot share a limit. Verify with focused tests, `pnpm test` and `pnpm check` during implementation. Confirm existing local spawn behavior is unchanged in this slice.

### Touch Points

- Confirmed: `src/model/config.ts` (ProjectConfig/BoardOverrides), `src/model/project.ts` (StoryView; there is no existing src/model/story.ts), `src/model/api.ts` (Story request/detail types).
- `src/server/project/config.ts`: loadProjectConfig/default handling, shared scheduling validation, reserved schema field and Board override rejection. Current config loading spreads raw values over defaults and has no scheduling validation.
- `src/server/project/story.ts`: StoryData, parseStory/serializeStory, built-in validation; preserve unknown custom keys.
- `src/server/project/service.ts`: StoryInput/StoryPatch, create/update/view plumbing and consistent online/offline validation. requestSpawn/drainQueue currently compare live Claims with maxConcurrentWorkers; keep their scheduling integration for DEV-10.
- `src/server/routes/stories.ts`: forward placement if request bodies are explicitly reconstructed. Add a focused pure module, suggested `src/model/placement.ts`, shared by later scheduler code.
- `test/config.test.ts`, `test/story.test.ts`, new `test/placement.test.ts`, service coverage in `test/offline.test.ts` and HTTP coverage in `test/http.test.ts` where relevant; `test/helpers.ts` supplies createService fixtures.
- `docs/specs/01-core-function.md`; consume DEV-7's delivered compatibility report and ADR when available. No runtime reservation/command schema changes in this slice.

### Assumptions

- DEV-7 was observed in `in_progress` with an active Worker on 2026-10-29; its compatibility report/ADR are not present in this Story checkout. The understandable policy can be refined now, but the explicit author sequencing requirement prevents advancing to development before DEV-7 is delivered. Reconcile final mapping terminology with its delivered contract before implementing.
- Stable IDs are opaque nonblank values; do not impose UUID formatting or infer physical-host identity from URLs. Reject exact duplicate canonical environment IDs; a real physical-host equivalence check is outside this pure slice. One environment per physical machine is an operator requirement.
- The Project mapping object above is policy data for future adapter use, not evidence that the installed T3 APIs support remote selection. Unknown/unverified capability remains ineligible until the adapter positively establishes eligibility.
- Shared service/HTTP plumbing is necessary to validate and persist placement without shipping editor or CLI controls. Existing custom fields remain separate; introducing a built-in name must surface collisions.
- Wait is a pure policy result; this Story neither mutates queues nor guarantees runtime eligible FIFO or atomic allocation. Tests supply reservation usage as data; DEV-10 implements authoritative accounting.

### Follow-ups

No additional Stories created. Existing sequence remains DEV-7 → DEV-9 → DEV-10 → DEV-11 → DEV-12. DEV-10 consumes policy for reservations/dispatch; DEV-11 owns remote execution/transport; DEV-12 owns controls/status and full feature acceptance. These are body-level sequencing gates, not automatic sf dependency scheduling.
