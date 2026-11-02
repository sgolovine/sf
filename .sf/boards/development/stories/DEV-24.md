---
title: Show the execution ledger and reconcile/cancel controls in the web UI
stage: done
dependsOn:
  - DEV-12
branch: sf/DEV-24
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/36
requires_validation_hil: false
requires_review_hil: false
---
## Outcome
A web view of the execution ledger: users see each occupying (and, optionally, recent terminal) Execution with its Story/Stage, reserved machine, status/outcome, Claim liveness, `waitingFor` reason, and Supervisor-reported task/thread IDs, and can request reconcile or cancellation from the browser with pending/error/result feedback.

## Context
Split from DEV-12 during refinement (2026-10-31). DEV-10 delivered the ledger, `GET /api/executions`, `GET /api/executions/:id`, `POST /api/executions/:id/reconcile|cancel` and the `sf execution list|show|reconcile|cancel` CLI. DEV-11 (2026-10-31 scope amendment) made machine handling harness-owned: sf only requests a machine. DEV-12 adds per-machine used/max to the sidebar and placement/config surfaces, but no execution list or recovery controls in the web UI.

## Acceptance Criteria
- [ ] A view reachable from the app (e.g. the sidebar Workers count) lists executions from `GET /api/executions`, occupying first, with an option to show terminal ones; per-machine usage vs capacity heads the list.
- [ ] Each row shows the reserved machine as *requested by sf*, separately from any harness-reported evidence/task/thread text. Remote task/thread IDs are plain text; do not build t3-thread links for remote IDs or invent remote status.
- [ ] Reconcile/Cancel buttons call the existing routes and show pending/error/result. Neither frees a slot by itself; the row stays occupying until correlated evidence arrives. No force-forget control.
- [ ] Unknown occupancy (Claim ended, execution not terminal) is visually distinct from an active Claim.
- [ ] Use existing React Query/api client/error banner conventions; add helper tests where meaningful and verify in the running app with screenshots.

## Touch Points
src/web/App.tsx, src/web/components/AppSidebar.tsx, a new executions component, src/web/api/client.ts, src/web/api/hooks.ts, docs/execution-ledger.md.

## Out of Scope
New recovery protocol, remote status APIs, scheduler changes.

## Refinement

### Outcome
Users open a Project-wide Executions view, understand which launches still consume capacity, and request Supervisor reconciliation or cancellation without mistaking request acceptance or Claim end for execution completion.

### Prerequisites and delivered changes
DEV-12 is Done (PR #27); its scheduling settings, Story placement controls, requested-machine display and Workers capacity footer are present in this checkout. DEV-10's ledger/routes and DEV-11's harness-owned machine request remain the authority. No dependency wait or human decision is outstanding.

### Scope
In: one Executions view, typed API methods/query hooks, recovery request feedback, meaningful helper coverage, running-app verification and operator documentation.
Out: new backend recovery behavior, remote discovery/status APIs, scheduling changes, terminal-report input, force-forget, pagination or unlimited history.

### Acceptance Criteria
- [ ] Make the existing Workers footer a keyboard-accessible entry to an Executions main-area view using App's existing in-memory view navigation. Provide a clear return to a Board and retain Project Settings/Board navigation. The ledger is Project-wide across all Boards, including when the selected Board has no executions. No URL routing feature is required.
- [ ] Load `GET /api/executions` through the authenticated `sfApi` client with `ExecutionsResponse`/`ExecutionView` types. Initially show only `occupying` entries; a labelled toggle shows all terminal history retained by the server. Keep occupying entries first and newest first within each group, matching service ordering. Show loading, empty, and recoverable fetch-error states.
- [ ] Head the view with machine used/capacity, including legacy local/maxConcurrentWorkers, disabled configured machines, lowered caps below usage, and unconfigured machines that still occupy. Reuse `machineUsage` and current session config; use authoritative ledger entries for usage rather than live Claim count. Unknown capacity is displayed as unknown, never zero. Retained terminal history never contributes usage.
- [ ] Each entry identifies execution ID, Story key, Board and Stage (resolve current names when available; fall back to stored IDs), requested machine name/ID, status and outcome, occupying state, explicit Claim active/ended text, and server `waitingFor`. Display any supplied evidence, conflict, recovery, outstanding attempt kind/ID, and Supervisor-reported task/thread/label without substituting them for requested placement. IDs/text may wrap and remain readable. All task/thread IDs are plain text; no inferred remote status or task/thread links.
- [ ] Use `claimLive` and `occupying` from the API: any occupying execution without a live Claim is visibly labelled as unconfirmed/awaiting end evidence, including `running` or `launching` entries, not just status `unknown`. Status `unknown` is also visually distinct. Use text as well as color. Terminal entries show outcome and no live recovery controls.
- [ ] Reconcile and Cancel send POST to the existing per-execution routes and consume the returned `ExecutionView`. Disable controls for terminal and `reserved` executions (explain that the launch has not been delivered). While an HTTP mutation is pending, prevent duplicate clicks on that row and show the requested action. A successful response says the request was sent to the Supervisor and shows the returned attempt/waiting state; it does not claim cancellation/completion. Render server rejection using the existing ErrorBanner/Act conventions while retaining the list and allowing retry. Keep the backend authoritative when a row changes between render and click.
- [ ] Keep the view current while open: refetch its query on session/SSE updates and after either mutation, with a bounded polling fallback (5 seconds while visible is sufficient). Stop polling when closed. Show eventual Supervisor evidence/terminal outcome without reopening. Do not optimistically remove a row, decrement usage, clear a Claim or change status merely because a request succeeded; a terminal response/evidence may legitimately free it. No direct runtime edits or new status protocol.
- [ ] Add focused node:test coverage for nontrivial presentation helpers introduced (for example filtering/order and unknown-occupancy classification); reuse existing ledger/HTTP tests for route semantics. Run focused tests, `pnpm test`, and `pnpm check`. Verify the running UI using a scratch Project with active Claim, occupying ended Claim, terminal history, remote requested machine/reported IDs, and reduced/disabled capacity. Exercise pending, request success, server error/retry, and eventual terminal refresh. Capture screenshots during validation and record how asynchronous responses were simulated; no real remote machine is required.
- [ ] Update docs/execution-ledger.md with where to open the view, terminal-history toggle, Claim versus occupancy meaning, and request/confirmation behavior. Explain that a cancellation request alone does not release capacity and remote placement is requested, not proven.

### Touch Points
- src/web/App.tsx: View union, navigation, Workers footer entry and view rendering (the current Workers count is in App, not AppSidebar).
- src/web/components/AppSidebar.tsx only if needed for consistent navigation; new Executions component and small helpers under src/web/lib if useful.
- src/web/api/client.ts and hooks.ts; existing execution route helpers/types in src/model/api.ts.
- src/model/placement.ts machineUsage (reuse), src/server/routes/executions.ts and service.ts (reference only; no redesign).
- Focused tests under test/ and docs/execution-ledger.md.

### Assumptions
- A main-area view follows current Project Settings navigation; no separate route or modal is needed.
- The server already returns bounded terminal history (currently 100) and sorts occupying first. The toggle shows retained history without inventing a retention control.
- Task/thread IDs are plain text for local as well as remote executions to keep the reporting boundary consistent.
- Existing API rejection for reserved/terminal requests is retained. No additional cancel confirmation dialog is required.
- Screenshot evidence is produced by validation; development still verifies the running app. No production execution is cancelled for verification.

### Follow-ups
None. This is one bounded UI PR.
