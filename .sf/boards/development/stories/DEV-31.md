---
title: Make remote machines it's own project level setting
stage: done
branch: sf/DEV-31
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/33
requires_validation_hil: false
requires_review_hil: false
---
- Currently remote machines are part of scheduling.
- Make a seperate feature, remote machines inherit max number of workers unless specified otherwise.
- The harness keeps track of the remote machine entirely. As such only instructions on which machine to use are passed down. Remove "Enviroment ID", "Project ID" and "Repository". Just keep the model label and slug. 
- When a story runs with that enabled, pass down instructions that say "The user specified that this work should be done on the machine: <machine_slug>"

## Refinement

### Outcome

Project owners manage Remote machines independently of Scheduling. A machine needs a display label and stable slug, with an optional Worker limit override. sf selects and reserves machines using existing placement rules, then tells the harness which slug to use; the harness owns remote machine discovery, preparation and launch.

### Scope

In: Project settings UI, persisted configuration and compatibility, CLI/API settings, placement/capacity resolution, launch instructions, execution identity handling affected by removing remote mapping fields, relevant tests and documentation.

Out: remote transport, credentials, discovery, harness-specific launch parameters, automatic machine provisioning, host-wide quotas, and changes to Worker model inheritance. Preserve existing Story placement modes and durable execution/Claim lifecycle.

### Acceptance Criteria

- [ ] Project settings exposes a separate Remote machines section/tab, usable without enabling per-machine Scheduling. Remote entries expose Machine label and Machine slug, Enabled, and an optional maximum concurrent Workers override. Environment ID, Project ID and Repository inputs are removed. Label is the existing `name`, slug is the existing `id`; retain current slug validation, uniqueness and reserved `local` rules. Label is nonblank. Neither label nor slug is a Worker model setting.
- [ ] Store the catalog at Project `remoteMachines` (entries `{ id, name, enabled, capacity? }`), independent of optional `scheduling`. Scheduling retains local capacity and ordered machine IDs, referencing this catalog rather than embedding remote definitions. Board overrides cannot define machines. UI, API and `sf project show/set` agree on this schema; omitted patch properties remain unchanged and `remoteMachines: []` clears the catalog subject to reference checks.
- [ ] An omitted remote capacity dynamically inherits Project `maxConcurrentWorkers`; clearing an override restores inheritance. Explicit capacity must be a finite nonnegative safe integer, with 0 preventing new reservations. Project maximum remains editable while Scheduling is enabled and is a per-machine default, not an additional global cap. Explicit local scheduling capacity retains its current meaning; without scheduling the local capacity is the Project maximum.
- [ ] Without Scheduling, inherited placement stays local; configured remotes can still be selected by a Story's required/preferred placement. Preferred placement falls back to local under the existing selector semantics. With Scheduling, inherit/preferred use its explicit machine order and required targets do not silently fall back. Configuring a remote alone does not automatically route inherited Stories there. Disabled remotes remain selectable as saved targets but their work waits.
- [ ] Existing configs with `scheduling.remotes` load compatibly: promote their entries to the independent catalog, preserve IDs, names, enabled flags, explicit capacities, local capacity, order and Story references, and discard obsolete remote environment/project/repository mappings on canonical save. A config containing both legacy and new catalogs fails with an actionable conflict error rather than silently choosing one. Projects with no remote configuration keep existing local behavior; reading does not rewrite files outside normal settings saves.
- [ ] When sf selects a remote, both the Supervisor launch request instructions and the Worker Brief include exactly the sentence `The user specified that this work should be done on the machine: <machine_slug>` with the selected slug substituted. Local selections omit it. Simplify the remote machine request to slug/label and instruction text; remove remote environment/project/repository data and obsolete detailed machine preparation prose. Preserve sf's own execution correlation metadata separately. Supervisor skill guidance follows the simplified contract and does not demand removed remote mapping fields or invent harness parameters.
- [ ] Removing or changing a slug is rejected while any Story references it or an occupying execution uses it, across Boards; changing a display label, capacity or enabled flag remains allowed. Settings saves remain atomic and drain queued work. Lowered caps do not terminate Workers. Queue selection, footer usage and Story placement/status views resolve from the independent catalog and effective capacity.
- [ ] New remote executions no longer require harness environment/project mapping in configuration: retain sf-owned Project/environment identity for correlation, machine slug for requested placement and separately reported harness identity where available. Legacy occupying executions and queued commands remain reconcilable after reload; do not drop occupancy, clear branch fences, retry uncertain launches or block all future launches merely because removed remote mapping fields are absent. Existing runtime identity fields used for local/sf authority are not removed indiscriminately.
- [ ] Tests cover catalog validation and migration, omitted versus explicit/zero capacity and clearing overrides, Project maximum changes updating inherited caps, remote placement without Scheduling, reference guards, exact remote instruction text/local omission, and execution restart/correlation with legacy remote entries. Run repository checks and relevant regression tests. Verify the separate settings UI, saving/reloading and placement selection in the browser with screenshot evidence during validation.
- [ ] Update current schema/examples, domain language and remote/Supervisor protocol documentation to describe the catalog, inheritance and simple machine instruction. Mark superseded ADR guidance rather than leaving conflicting current requirements.

### Touch Points

- `src/model/config.ts`, `src/model/placement.ts`, `src/model/commands.ts`; execution/runtime types as needed for compatible identity handling.
- `src/server/project/service.ts` (settings validation, references, eligibility, reservations and identityFor), config loading/persistence, `src/server/project/brief.ts`.
- `src/cli/story.ts` and Project settings command/API handling.
- `src/web/App.tsx`, `src/web/components/SchedulingSettings.tsx`, `src/web/lib/schedulingDraft.ts`, `src/web/components/StoryEditor.tsx`; API settings types and machine usage displays.
- `test/placement.test.ts`, `test/story-placement.test.ts`, `test/scheduling-draft.test.ts`, `test/machine-scheduling.test.ts`, `test/brief.test.ts`, `test/execution.test.ts` and scheduling fixtures.
- `CONTEXT.md`, `docs/specs/01-core-function.md`, `docs/remote-workers.md`, `docs/execution-ledger.md`, `docs/adr/0003-remote-worker-boundaries.md`, and `.agents/skills/sf/SKILL.md` (plus distributed copy if applicable).

### Assumptions

- “model label and slug” means machine display label and machine slug, matching existing name/id; it does not add model configuration to machines.
- Enabled and optional capacity are operational controls retained alongside the two identity fields. This story separates the catalog in persistence as well as the settings UI.
- Project maximum is a dynamic default for each remote, not a sum across all machines. Existing explicit capacities remain overrides during migration.
- Keep placement mode/order behavior and sf's execution ledger. Removing harness mapping requirements does not remove sf-owned identity or durable lifecycle safeguards.
- No prerequisites or delivered changes were listed on the current Story; the existing DEV-9/10/11/12 implementation is present in this checkout and is the baseline for this change.

### Follow-ups

None. This is one coherent settings/dispatch contract change.
