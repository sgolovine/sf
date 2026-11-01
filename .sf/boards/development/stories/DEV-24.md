---
title: Show the execution ledger and reconcile/cancel controls in the web UI
stage: backlog
dependsOn:
  - DEV-12
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
