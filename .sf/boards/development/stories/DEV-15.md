---
title: Add button to bottom of columns to add story to that column
stage: done
branch: sf/DEV-15
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/15
requires_validation_hil: false
requires_review_hil: false
---
Add a button to the bottom of each column that allows users to create a story. When they click that button, the "New Story" modal comes up but the "Stage" field is populated by the stage they clicked the button from.

Ie. if a user clicks the button on a stage called "Ready for Development", the stage inside that create should automatically be set to "Ready for Development"

## Refinement

### Outcome

Users can start creating a Story from any configured Stage on the current Board. The existing New Story dialog opens with that Stage selected, and creating the Story places it in the selected Stage.

### Scope

In: a create-Story button after the Story cards in each configured Stage; passing an initial Stage from the Board through App to StoryEditor; preserving the existing creation workflow; updating the core specification to describe this entry point.

Out: a separate dialog or inline creation form, API/CLI/storage changes, changes to Worker dispatch rules, Stage management, or a create button in the synthetic Unknown Stage group.

### Acceptance Criteria

- [ ] Every configured Stage, including Backlog, Done, and empty Stages, displays an add-Story button at the bottom of its column after any Story cards. The button uses the existing UI components and is keyboard operable, with an accessible name identifying its action and target Stage.
- [ ] Activating a Stage button opens the existing New Story dialog for the current Board, on Details, with Stage set to the clicked Stage's stable id and its current display name shown. Verify a custom Stage whose name differs from its id, such as Ready for Development.
- [ ] The preselected Stage remains editable. Saving creates the Story in the final selected Stage through the existing create API, with normal validation, attachments, custom fields, model inheritance, and Stage-entry behavior preserved. The inherited Worker model shown in the dialog reflects the selected Stage.
- [ ] Canceling creates no Story. Opening creation from another Stage after cancel or successful creation starts a fresh form with the new target Stage, without retaining the previous form's Stage or other values.
- [ ] The header New Story button continues to open a fresh form defaulting to Backlog, including after using a Stage button. Existing Story editing continues to show its actual Stage read-only. Existing card opening and drag-and-drop Moves still work.
- [ ] The synthetic Unknown Stage group has no create button. Verify the new entry point in the running UI for empty and populated Stages, custom Stage selection, changing the selection before saving, cancel/reopen, and the header default; capture UI evidence and run the repository's relevant checks (pnpm check and pnpm test).

### Touch Points

- src/web/components/BoardView.tsx: render each Stage's button and expose a Stage-specific creation callback; retain the separate Unknown Stage handling.
- src/web/App.tsx: carry an optional initial Stage in creation state and pass it to StoryEditor; keep the header entry point defaulting to Backlog.
- src/web/components/StoryEditor.tsx: initialize new-Story Stage from the supplied default. Account for both its useState initializer and existing effect, which currently reset creation to Backlog. Preserve user edits during normal session refreshes.
- docs/specs/01-core-function.md: extend the Story dialog description with Stage-specific creation and the header Backlog default.
- Existing src/web/api/client.ts createStory and src/server/project/service.ts createStory already accept and validate the Stage; reuse them.

### Assumptions

- Bottom means after the cards in the existing content-height column; no sticky footer or column height redesign is required.
- Use a visible plus icon and New Story text consistent with the existing header action; include the Stage name in the accessible name.
- All configured Stages are valid creation targets. Creating directly into a Stage keeps the existing Stage-entry semantics, including Worker triggering where configured.
- A Stage is only a default, not a restriction; users can choose a different Stage before saving.
- No prerequisites or delivered implementation changes are recorded on this Story; the inspected worktree is clean and the feature is not present.

### Follow-ups

None. This is one bounded, reviewable UI change.
