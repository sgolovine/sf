---
title: Create board should be a modal
stage: done
branch: sf/DEV-16
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/16
requires_validation_hil: false
requires_review_hil: false
---
- When creating a new board, a modal should come up like it does when creating a new story.

## Refinement

### Outcome

Choosing New Board opens a modal dialog over the current screen, using the same shared Dialog components and interaction conventions as New Story. Users can create a Board or dismiss the dialog and resume their previous screen.

### Scope

In: replace the full-page Board creation card with a dialog; preserve the Name and Key form and existing Board creation API; handle empty Projects and Projects with existing Boards; accessible dismissal, submission feedback, and responsive layout.

Out: changes to Board persistence, API/CLI contracts, default Stages, Story creation, or Board settings functionality.

### Acceptance Criteria

- [ ] New Board in the sidebar opens a dialog with an overlay, accessible title and description, Name and Key inputs, Cancel, Create Board, and a close control. Use the shared Dialog primitives already used by StoryEditor rather than a custom modal implementation.
- [ ] Opening the dialog leaves the underlying selected Board or settings screen and its navigation state intact. Dismissing via Cancel, close control, Escape, or outside click creates nothing and returns to that screen. Reopening starts with empty inputs.
- [ ] Focus moves to Name when opened, remains inside the modal while open, and returns to the initiating control on dismissal. The dialog fits narrow screens and can scroll within a short viewport.
- [ ] Preserve existing form behavior: Key input uppercases typed text; Create Board is disabled while either trimmed field is empty; submitting by button or Enter uses the existing createBoard API with Name and Key and creates the same default Stages.
- [ ] While a creation request is pending, prevent duplicate submissions and dismissal. On a rejected request, keep the dialog open with entered values and a visible, accessible error inside the dialog; allow correction and retry.
- [ ] After successful creation, close the dialog and select/display the new Board, with the sidebar updated through the existing session refresh mechanism.
- [ ] With no Boards (including an uninitialized Project), automatically open the same creation dialog initially. Dismissing it leaves a usable empty state with an explicit New Board action so creation can be reopened; do not repeatedly reopen it on session refresh. First Board creation still initializes the Project through the existing API.
- [ ] Validate in the running UI: open/cancel from a Board and settings, keyboard focus and dismissal, blank fields, successful creation, duplicate-name/key error and retry, pending submission behavior, and first-Board creation/dismiss/reopen. Check narrow viewport layout and run the repository's relevant static checks. Record the validation evidence for the later validation Stage.

### Touch Points

- `src/web/App.tsx`: separate dialog visibility from main-view navigation; preserve the underlying view; handle no-Board state and successful selection.
- `src/web/components/CreateBoard.tsx`: replace Card presentation with shared Dialog components and add local submission/error state.
- `src/web/components/AppSidebar.tsx`: reconcile New Board active state and selected Board highlighting with dialog visibility.
- `src/web/components/StoryEditor.tsx` and `src/web/components/ui/dialog.tsx`: reference for dialog composition, focus, dismissal, and submission conventions.
- `src/web/api/client.ts` and `src/web/api/hooks.ts`: retain existing creation and session refresh behavior.
- `docs/specs/01-core-function.md`: document the Board creation dialog alongside the existing Board/Story UI behavior.

### Assumptions

- “Like creating a new story” means shared modal behavior and styling; the smaller two-field Board form does not need Story tabs or its full width.
- No-Board startup should retain the current immediate invitation to create a Board, expressed as an initially open, dismissible dialog with an empty-state fallback.
- Dismissing abandons unsaved Name/Key values without an additional confirmation, matching the existing Story dialog convention.
- Errors must appear inside the modal because the existing global ErrorBanner sits behind the overlay.
- This is one focused UI change; no prerequisite Stories or delivered changes need reconciliation. No implementation changes have been made during refinement.

### Follow-ups

None.


## Development

Implemented and pushed `10fd4ef`; merged current `origin/main` in `146bbcf`. New Board is a shared Dialog that preserves navigation, resets abandoned inputs, handles pending/error/retry state locally, and supports empty Projects. Documentation and HTTP regression coverage updated.

`pnpm check` passed; `pnpm test` passed (144 tests) on merged head. Browser checks covered first Board, focus trap/return, Cancel/Close/Escape, field reset/uppercase/blank validation, duplicate Name/Key retries, settings preservation, delayed submissions, and 360x320 scrolling. Development evidence and screenshots are attached as `dev16-validation.md`, `pending.png`, `narrow.png`, and `narrow-scrolled.png`. The evidence names remaining explicit validation checks: physical outside clicks and empty-state session refresh. No prerequisites or outstanding review findings.
