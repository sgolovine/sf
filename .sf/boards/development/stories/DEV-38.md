---
title: Auto load balancing for local / remote
stage: in_progress
branch: sf/DEV-38
requires_refinement_hil: false
---
- Ensure that we always balance the load between configured local and remote machines.
- Say local has 3 worker slots, remote has 5 worker slots.
- Ensure that we are always maxing out each machine, that is we always have 8 items running (so long as their are things to run).

## Refinement

### Outcome

Stories with inherited placement automatically use spare local and remote Worker capacity. With local capacity 3, an enabled remote capacity 5, a launch-capable Supervisor and at least eight eligible independent Stories, sf dispatches eight Workers (3 local and 5 remote) without requiring a manually configured machine order. Confirmed completion refills available slots from queued eligible work.

### Scope

In: automatic candidate selection when Project `scheduling` is absent; regression coverage for aggregate capacity and queue refill; accurate settings/help/docs describing automatic placement and explicit scheduling overrides.

Preserve the existing explicit `scheduling.order` as an intentional override, including exclusions and an empty order. Preserve Story placement and per-machine capacity rules. Use existing first-fit selection and durable execution reservations rather than introduce another scheduler.

Out: CPU/memory telemetry, equal or proportional distribution with fewer Stories than slots, migrating running Workers, preemption, host-wide/cross-Project quotas, harness remote discovery/transport, and new lifecycle polling.

### Acceptance Criteria

- [ ] Without `scheduling`, normalized inherited candidate order is local followed by remote catalog order. Disabled remotes remain in the policy for status/diagnostics but cannot receive new Workers. Local uses `maxConcurrentWorkers` (default 3); each remote uses its explicit capacity or inherits that same default. With no remotes, behavior remains local-only.
- [ ] With `maxConcurrentWorkers: 3`, no `scheduling`, and one enabled remote with capacity 5, concurrent eligible inherited Story requests across Boards reserve exactly 3 local and 5 remote executions; a ninth waits. There is no aggregate limit of 3 and no machine exceeds its capacity. Test the service/dispatch path, not only the pure selector.
- [ ] With queued eligible work, correlated terminal evidence on either machine refills that machine's free slot in the same mutation/drain cycle, without a manual Move or waiting for the periodic sweep. Duplicate reports or repeated drains do not duplicate Workers. Cover both local and remote refill and restart/recovery with occupied slots.
- [ ] An explicit scheduling order remains authoritative: listed machines are tried first-fit in that order; omitted machines are not appended; an empty order queues inherited work. Removing scheduling restores automatic catalog participation. Adding/enabling a remote or raising capacity wakes queued work through existing mutation drains.
- [ ] `local-only` never uses remote capacity, `required` never falls back, and `preferred` tries its target then the effective Project order with stable deduplication. Zero-capacity, disabled or ineligible machines receive no new reservations. A waiting pinned Story does not block later eligible Stories.
- [ ] Every nonterminal execution continues to occupy its machine slot across Boards, including reserved, launching and unknown entries. Move/release/Claim expiry alone never frees it. Cap reductions stop new launches without terminating or relocating existing Workers; branch fences, dependency/HIL/prompt gates and FIFO among eligible Stories remain intact.
- [ ] Remote selections still produce the existing machine request and machine sentence in the Worker Brief; actual remote execution remains the harness's responsibility. No new remote adapter or invented launch parameters are added.
- [ ] Settings text, CLI/help comments, README, CONTEXT.md and relevant scheduling/spec/runbook/skill reference text consistently describe automatic placement without scheduling and explicit order overrides. The Settings switch must clearly indicate that it controls custom capacity/order, since its off state now still schedules across machines. Update tests asserting the superseded local-only default. Existing configured explicit orders are not silently rewritten.
- [ ] Focused placement, machine-scheduling and execution tests plus repository-required checks pass; validation verifies the affected Settings copy in the UI.

### Touch Points

- `src/model/placement.ts`: `normalizePlacementPolicy`, selector documentation and preferred fallback behavior.
- `src/server/project/service.ts`: `drainQueue`, reservations, mutation drains and terminal-report paths; retain existing machinery and change only if regression tests reveal a gap.
- `src/model/config.ts`, `src/model/api.ts`, `src/cli/story.ts`: configuration contracts/help as affected.
- `src/web/components/SchedulingSettings.tsx`: custom scheduling switch/help and initial custom order consistent with effective automatic order.
- `test/placement.test.ts`, `test/machine-scheduling.test.ts`, `test/execution.test.ts`, `test/story-placement.test.ts`, related config/CLI/UI tests.
- `CONTEXT.md`, `README.md`, `docs/specs/01-core-function.md`, `docs/execution-ledger.md`, `docs/remote-workers.md`, `docs/verification/machine-scheduling.md`, `skills/sf/references/commands.md` and other active descriptions of the prior default. Keep historical verification distinguishable from new results.

### Assumptions

- “Balance” means work-conserving use of allowed machine slots, not equal distribution or least-utilized-machine selection. First-fit is retained; a small queue may fill local before remote.
- “Configured” means catalog remotes participate automatically unless an explicit Project order or Story placement restricts them. This intentionally changes the previous no-scheduling local-only default; users can retain local-only behavior with explicit order `["local"]` or Story placement.
- “Always eight running” means eight occupying dispatched executions once the harness accepts launches, while enough eligible work and machine launch capability exist. sf cannot guarantee instantaneous harness startup, bypass safety holds, or certify actual machine location from a request.
- Existing implementation already supplies multi-machine reservations, eligible FIFO and refill; strengthen end-to-end coverage and fix demonstrated gaps rather than replace those mechanisms.
- No prerequisites are recorded, and the necessary catalog, scheduling and execution-ledger code is already present in this checkout.

### Follow-ups

None; this is one bounded scheduling/default-behavior change with documentation and regression coverage.
