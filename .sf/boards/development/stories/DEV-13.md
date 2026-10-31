---
title: Add dependency waits with automatic wake-up separate from HIL
stage: todo
---
## Problem
Workers currently use human-in-the-loop (HIL) flags as a waiting state when another Story must finish first. The refinement Stage Prompt says “Blocked, or anything else that stops you” must set HIL. This converts ordinary sequencing into a manual hold: completion of the prerequisite does not clear HIL or restart the waiting Story.

Observed example: DEV-9 → DEV-10 → DEV-11 → DEV-12 are held in refinement behind the DEV-7 dependency chain. DEV-7 is now Done, but DEV-9's HIL comment still describes it as in development. The refinements were saved; dependency completion did not resume the work.

## Outcome
A Story can wait on explicit Story dependencies without requesting human intervention. sf owns scheduling and automatically resumes its current Stage when all dependencies are Done. HIL means a concrete decision or action is required from a human, and remains independent of dependency waits.

## Scope
- Add persisted, structured Story dependencies (proposed shape: `dependsOn: [DEV-7]`) and a supported CLI/service/UI workflow for reading, setting and clearing them.
- Gate Worker dispatch on dependency completion and expose which prerequisites are unresolved.
- Give Workers a supported way to record a dependency wait and release their Claim without setting HIL. Include the command and dependency information in Worker Briefs.
- Reconcile dependency readiness when prerequisites change, dependencies are edited, and sf starts or recovers; use the existing spawn queue and capacity rules.
- Update factory Stage Prompts and relevant skills so dependency waits and requests for human input have distinct outcomes. Remove blanket instructions that turn every impediment into HIL.
- Provide a deliberate migration path for existing dependency-only HIL holds, including DEV-9 through DEV-12.

## Acceptance Criteria
- [ ] Structured dependencies survive serialization, reload and unrelated Story edits. Stories without dependencies retain existing behavior. Validate missing references, self-dependencies and cycles with actionable errors; define and document cross-Board reference behavior and safe handling of removed prerequisites.
- [ ] A Story in a Stage with an enabled prompt does not launch a Worker while any dependency is not Done. It stays in that Stage with a visible dependency-wait reason, without requiring or setting HIL.
- [ ] When the last prerequisite becomes Done, sf automatically queues one Worker for the waiting Story's current Stage, subject to existing capacity, Claim, prompt and HIL rules. The Worker rereads delivered changes and reconciles the Story before advancing; dependency completion does not blindly Move it to development.
- [ ] Dependency edits and startup recovery reevaluate waits, including prerequisites that completed while sf was stopped. Repeated events, concurrent completions and restarts do not cause duplicate launches. Recheck dependencies before launching a queued Worker; do not terminate an already-running Worker when a prerequisite later reopens.
- [ ] Workers can explicitly declare dependency waits and release their Claim through sf commands. Recording the wait and releasing must not lose a wake-up if the prerequisite completes concurrently. Worker Briefs explain this mechanism and reserve HIL for a specific human decision/action.
- [ ] Dependency waiting and HIL are independent: resolving dependencies never clears a genuine HIL flag, and clearing HIL never bypasses unresolved dependencies. If both apply, display both reasons. Clearing the final applicable hold resumes eligible work.
- [ ] CLI/JSON and UI expose dependency keys, unresolved prerequisites and whether a Story is waiting on dependencies, human input, or Worker capacity. Users can set/clear dependencies through supported service paths, with online/offline validation parity.
- [ ] Update refinement/development/validation/review prompts and applicable skills to distinguish Ready/completed work, Waiting on dependencies, and Needs human input. Do not use HIL for an observable Story dependency. External prerequisites that require someone to grant access, choose scope or provide configuration can still require HIL; arbitrary external condition monitoring is out of scope.
- [ ] Provide a CLI-backed migration procedure for dependency-only HIL holds. Recheck current Story state before changing anything; preserve genuine human requests and comments. For DEV-9/10/11/12, encode the intended dependency chain and clear only confirmed dependency-only holds; preserve DEV-11's separate integration/access requirements if still unresolved. Never infer that all HIL flags are safe to clear.
- [ ] Add meaningful regression tests covering a dependency chain, multiple prerequisites, already-Done prerequisites, offline completion/startup, queue races/deduplication, invalid dependency graphs, and independent HIL/dependency holds. Include the DEV-7 Done → DEV-9 automatically resumes scenario. Run repository checks and verify the waiting/resumed UI behavior.

## Touch Points
Story/config/API models and persistence; shared service validation; dispatch queue and startup recovery; CLI Story commands; Story editor/cards/details; Worker Brief generation; Stage Prompts; sf and repository Stage skills; specs and documentation. Confirm exact contracts during refinement.

## Boundaries
Use existing Story completion (Done) as the dependency condition. Do not introduce timed polling, arbitrary external watchers, automatic HIL clearing based on comment text, or automatic advancement past a Stage. Creating this ticket does not authorize changing the existing held Stories yet; migration belongs to implementation and verification of this feature.
