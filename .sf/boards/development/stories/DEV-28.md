---
title: '"CTRL + Enter" should save a story'
stage: done
branch: sf/DEV-28
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/31
requires_validation_hil: false
validation_rounds: 1
requires_review_hil: false
---
When on either `/create` or editing a story, pressing "CTRL+Enter" should save the story. Use https://tanstack.com/hotkeys/ for hotkey implementation

## Refinement

### Outcome
Users can submit the open New Story or Edit Story dialog with Ctrl+Enter, with the same result as its Create Story, Save, or Retry submission button.

### Scope
In: TanStack Hotkeys React integration in the shared StoryEditor, its dependency and lockfile, and documentation/verification of the shortcut.
Out: other forms, global hotkey migration, configurable shortcuts, and additional platform-specific shortcuts.

### Acceptance Criteria
- [ ] Use TanStack Hotkeys (https://tanstack.com/hotkeys/) through its React adapter for shortcut registration, rather than a handwritten keydown listener. Add the required dependency and update pnpm-lock.yaml.
- [ ] With New Story open at `/create`, Ctrl+Enter submits the current form once, persists its current values and pending attachments through the existing create path, and closes/navigates exactly as clicking Create Story does.
- [ ] With an existing Story open at `/<KEY>`, Ctrl+Enter submits current edits through the existing update path and closes/navigates exactly as clicking Save does. The shortcut uses current state after editing fields or switching tabs.
- [ ] The shortcut works while title, description textarea, or custom field inputs have focus, and on either Details or Custom Fields, including Description Preview. It prevents the handled chord from inserting a newline or triggering a second native submission; ordinary Enter in the description still inserts a newline.
- [ ] Shortcut eligibility matches the submit button: blank/whitespace-only title, submitting, deleting, or an open delete confirmation must not save. Holding/repeating the chord or pressing it while a request is pending must not start duplicate submissions.
- [ ] Existing error behavior is preserved: rejected saves keep the dialog and error visible; an uncertain transport failure allows the shortcut to activate Retry submission using the existing retained request/submission id rather than creating a fresh submission.
- [ ] Registration is limited to the open Story editor and cleaned up on close/unmount; Ctrl+Enter elsewhere does not create or update a Story. A nested modal/popover that owns keyboard interaction must not accidentally submit the underlying Story.
- [ ] Update the Story UI section of docs/specs/01-core-function.md with the shortcut. Verify create and edit in the browser, field focus/tab behavior, invalid title, pending request/repeated chord, delete confirmation, and cleanup after closing; include focused automated coverage where supported and run repository checks and tests.

### Touch Points
- src/web/components/StoryEditor.tsx: shared form, save function, submit disabled conditions, confirmation and retry state.
- src/web/App.tsx: existing route/dialog lifecycle (context; likely no change required).
- package.json and pnpm-lock.yaml: TanStack Hotkeys React adapter.
- docs/specs/01-core-function.md: Story dialog behavior.
- Relevant test coverage; existing tests use node:test and do not currently provide a mounted React/browser test harness.

### Assumptions
- Ctrl means the literal Control modifier on every platform; Command+Enter is not required by this Story. Do not replace the requested chord with a platform-dependent Mod alias.
- Reuse the existing form/save behavior, including retry-only submissions, attachments, validation and post-save navigation. Any guard needed to align keyboard eligibility with the existing button belongs in this change.
- No visual shortcut hint is required; the documented shortcut is sufficient for this bounded change.
- No prerequisites or delivered changes were reported on the Story, and none are needed for this shared-component change.

### Follow-ups
None.
