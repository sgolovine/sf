---
title: Filter "Done" stories out of "Depends on" Field.
stage: in_progress
branch: sf/DEV-35
requires_refinement_hil: false
---
## Refinement

### Outcome
The Story editor's **Depends on** dropdown offers only Stories that are not in Done, making outstanding prerequisites easier to find. Already selected dependencies remain visible and editable after they reach Done.

### Scope
In: the shared dependency picker used by New Story and Edit Story, across every Board in the Project; preservation and correct display of selected dependencies; focused verification and documentation of the selection rule.
Out: changes to stored dependency lists, CLI/API dependency validation, Worker eligibility or wake-up behavior, Story cards, automatic dependency removal, and new filtering controls.

### Acceptance Criteria
- [ ] In both New Story and Edit Story, the Depends on dropdown excludes every Story whose Stage id is `done`, including Stories from other Boards. Exclusion applies with an empty search and when searching by key or title, for mouse and keyboard selection.
- [ ] Eligible non-Done Stories remain selectable across Boards. Existing self-exclusion, search behavior, ordering, cross-Board labels, multi-selection and removal continue to work.
- [ ] An existing selected dependency that is Done remains a normal removable pill showing its key and title. It is not offered in the dropdown and is not marked missing. Opening or saving the editor does not drop that dependency unless the user explicitly removes it. Removing it keeps it unavailable for re-selection while it is Done.
- [ ] Truly missing selected dependencies retain the existing missing warning and removal behavior; hiding Done candidates must not conflate them with missing Stories.
- [ ] When the picker receives updated Board data, a Story newly in Done disappears from available options without silently changing the selected keys; a reopened non-Done Story becomes available again. An empty result uses the existing “No matching Stories” state, and Enter cannot select an excluded Story.
- [ ] Add focused regression coverage for candidate filtering across Boards and the distinction between selected Done and missing dependencies. Verify New Story/Edit Story selection, search and removal behavior in the browser, including the all-Done/no-matches case. Existing dependency service tests continue to pass without changing the contract that CLI/API clients may reference Done Stories.
- [ ] Update the Story dependencies section of `docs/specs/01-core-function.md` to describe the dropdown exclusion and preservation of existing Done dependencies.

### Touch Points
- `src/web/components/DependencyPicker.tsx`: build eligible dropdown candidates separately from the lookup used to label selected pills; use the existing Stage id `done`, rather than a display label.
- `src/web/components/StoryEditor.tsx`: shared picker integration for create/edit and selected-key submission; likely no behavioral change needed here.
- `test/`: focused picker regression coverage following existing Node/esbuild web-component test conventions where suitable; `test/dependencies.test.ts` covers persistence, validation and already-Done prerequisites.
- `docs/specs/01-core-function.md`, “Story dependencies and automatic wake-up”.

### Assumptions
- “Filter Done stories out” means hide them from available choices, preserving previously saved dependencies for history and reopening semantics. It does not mean remove them from stored `dependsOn` or hide selected pills.
- The filter applies Project-wide because dependencies already support cross-Board selection.
- All Done Stories are hidden from dropdown results, even when already selected; their pills provide removal.
- No new dependency or human decision is required. Current code has one shared picker and a stable `done` Stage id, so this fits one focused PR.

### Follow-ups
None.
