---
title: Pass selected machine instructions to the underlying harness
stage: done
dependsOn:
  - DEV-7
  - DEV-9
  - DEV-10
branch: sf/DEV-11
requires_refinement_hil: false
requires_dev_hil: false
requires_validation_hil: false
requires_review_hil: false
pr_url: https://github.com/sgolovine/sf/pull/26
---
## Outcome

When placement resolves to "Use X Machine", sf appends explicit instructions to the Worker launch request telling the underlying harness to start the Worker on X. T3/the harness owns actual machine handling.

## Product decision — 2026-10-31

The user explicitly revised the scope: "let the actual machine handling happen on the T3/Harness side. For the sf integration, when a user selects 'Use X Machine', it should just append additional instructions to the request so the underlying harness knows to start on a different machine."

This supersedes the former DEV-11 remote-adapter, discovery/preflight, worktree-transfer, scoped network transport and real remote lifecycle requirements. Missing remote APIs and a configured test machine no longer block sf's instruction integration. Reconcile earlier reports and ADR 0003 as part of implementation.

## Refinement

### Outcome

The Supervisor/harness sees the selected machine before launching the Worker. Completion means correct machine instructions reach the outgoing request; sf does not certify that it moved execution itself.

### Scope

In: propagate resolved placement into the existing Worker request; append readable machine instructions; document the harness-owned boundary; focused request/brief tests. Consume delivered DEV-9 policy and DEV-10 reservation contracts.

Out: sf-owned machine discovery/pairing, remote launch/status/cancel adapters, remote repository/worktree preparation or cleanup, cross-machine Git transfer, network credentials, remote Story-command transport and real remote execution certification. T3/harness owns machine handling and execution setup. Do not invent launch-tool parameters.

### Acceptance Criteria

- [ ] Reconcile against delivered DEV-7/9/10 on the current development base. Reuse placement and reservation contracts rather than create another policy or ledger.
- [ ] For resolved machine X, append a clearly delimited instruction to the request consumed by the Supervisor/harness before Worker launch: start this Worker on X using harness machine handling. Include the configured machine name and stable identifier as data.
- [ ] The launcher must see the instruction before choosing execution location. Adding instructions only to an already-started Worker's prompt is insufficient. Preserve instructions when forwarding through supported launch modes.
- [ ] Preserve required/preferred/local-only intent from the resolved policy. Required X does not permit local fallback; preferred selection communicates permitted fallback. Default/local requests preserve existing local behavior.
- [ ] Preserve Story/Stage identity, prompts, configured/project/Board instructions, model selection, Claim/HIL guidance and resources. Do not imply Supervisor-local paths exist remotely; identify them as authority context and leave machine preparation and authority access to the harness.
- [ ] Distinguish requested placement from confirmed execution. Instructions alone are not evidence of remote execution. Use existing result/error reporting without inventing remote status, machine confirmation or task links.
- [ ] Update skills/sf/SKILL.md, references/commands.md, docs/remote-workers.md and ADR 0003 to reflect the revised responsibility boundary. Replace mandatory sf-owned remote API/transport/lifecycle gates that contradict this decision; keep historical observations clearly dated.
- [ ] Focused tests verify machine selection reaches the outgoing launcher request, required/preferred wording, preservation of existing brief content and unchanged default/local behavior. Run relevant tests and pnpm check. No real remote target or remote API discovery is required for acceptance.

### Touch Points

src/server/project/brief.ts; WorkerSpawnCommand in src/model/commands.ts; spawn/request composition in src/server/project/service.ts; delivered placement/execution types; skills/sf/SKILL.md and references/commands.md; docs/remote-workers.md and docs/adr/0003-remote-worker-boundaries.md; focused brief/command tests. Confirm delivered paths on main before coding; this checkout may predate prerequisites.

### Assumptions

- This is harness-neutral instruction delivery, not a new sf machine-management layer.
- DEV-7/9/10 are delivered according to the current Story record. Update the Story worktree from main and inspect actual contracts before implementation.
- User scope direction resolves the prior HIL. The user explicitly requests clearing HIL and moving this Story to In Development after the revision.
- This changes the planned contract, not a claim that the current runtime already implements it.

### Follow-ups

DEV-12 owns user-facing machine controls and status integration under this same harness-owned boundary. No new sf machine-handling Story is required. Dependencies remain DEV-7 → DEV-9 → DEV-10 → DEV-11 → DEV-12.
