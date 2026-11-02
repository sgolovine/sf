---
title: Full Screen Markdown Editor
stage: in_progress
branch: sf/DEV-42
requires_refinement_hil: false
---
- Update the textarea / markdown editing component
- Add a button next to "Write/Preview" that will allow the user to view that textarea as a full-screen
- This will open another modal where the modal will take the entire space in the viewport up.
- At the bottom we have a close button
- Show an "X" button at the top
- Changes are autosaved to the underlying form.
- Should also have a way to open right to full-screen

## Refinement

### Outcome

Users can expand a Story Description or Markdown custom field into a viewport-filling editor, write or preview its Markdown, and return to the same form with their draft intact. Callers can also initialize the shared editor directly in full-screen mode.

### Scope

In: the shared MarkdownEditor used by Story Description and Markdown custom fields; a nested full-screen dialog; draft synchronization; a caller-facing initial-open option; focused verification and documentation of the behavior.

Out: converting other plain textareas (including Stage Prompt settings), server-side autosave, new routes, persistent full-screen preferences, and changes to Story Save/Create/Cancel semantics.

### Acceptance Criteria

- [ ] Every existing MarkdownEditor instance shows an accessible, keyboard-operable Full screen button beside Write/Preview. Activating it opens a dialog for that field without submitting the parent form.
- [ ] The dialog fills the viewport at desktop and narrow/short mobile sizes, overriding the shared dialog's default maximum width and margins. The editor/preview uses the available space and scrolls internally; its top controls and bottom Close action remain reachable without horizontal overflow.
- [ ] The dialog identifies the field with an accessible title, exposes Write and Preview using the existing Markdown renderer and empty-preview behavior, and preserves the current mode on expansion and return. Existing inline defaults (Preview for nonblank initial content, otherwise Write) and double-click-to-edit behavior remain intact.
- [ ] Full-screen edits call the same onChange callback as inline edits on every change. The parent form draft is the single source of truth: closing/reopening or switching modes loses no text, and prop value updates remain visible. There is no separate Apply or Save operation in the full-screen editor.
- [ ] A top X, a bottom Close button, and Escape close only the full-screen dialog, retain the draft, and leave the parent Story dialog open. Focus is trapped in the active dialog and returns to its opening control when available; direct-open dismissal restores focus to a sensible inline control. Repeated open/close works without duplicate textarea IDs or focus leaks.
- [ ] Expanding, editing, or closing never triggers Story submission or cancellation. Parent Ctrl+Enter submission is inactive while the nested full-screen dialog is active; after closing, the existing Story submission shortcut works normally. All editor action buttons are non-submit buttons.
- [ ] MarkdownEditor exposes an optional defaultFullScreen boolean (default false) that opens it in full-screen mode on mount with the supplied value. Closing returns to its inline editor; ordinary parent rerenders do not reopen it. Existing callers retain their current inline initial presentation.
- [ ] Story Description and Markdown custom fields both retain full-screen edits in the underlying form; Save/Create persists them through the existing flow and cancelling the parent discards unsaved changes as before. No API persistence is added to onChange.
- [ ] Validation covers both field kinds, nonblank/empty content, Markdown preview, immediate parent draft updates, all close paths, repeated opening, direct-open initialization, nested keyboard/focus behavior, and narrow/short viewport layout. Run the repository's applicable checks and record browser evidence for the UI behavior.

### Touch Points

- src/web/components/MarkdownEditor.tsx: shared controlled editor, expansion control, dialog, initial-open option.
- src/web/components/ui/dialog.tsx: existing Radix dialog primitives; prefer per-instance layout overrides rather than changing every dialog.
- src/web/components/StoryEditor.tsx: Description and FieldInput Markdown callers; existing Ctrl+Enter guard and nested-dialog behavior.
- docs/specs/01-core-function.md: Story editing / Markdown field behavior and keyboard interaction.
- Relevant test coverage under test/ and browser verification; pnpm check and pnpm test as applicable.

### Assumptions

- “Autosaved to the underlying form” means live draft synchronization through value/onChange, consistent with the existing explicit Story Save/Create flow; it does not mean writing to disk on each keystroke.
- “Open right to full-screen” means a reusable component initialization option, not a URL, persisted preference, new Story entry point, or forced full-screen for existing callers.
- Expansion retains the current Write/Preview mode; users can switch modes inside full-screen.
- Full-screen is a nested modal with independent dismissal. Parent submission is suspended while it is open so editing cannot unexpectedly close the containing form.
- This is one coherent PR and has no prerequisite Stories or delivered changes to reconcile.

### Follow-ups

None.
