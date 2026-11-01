---
title: Story modal changes
stage: done
branch: sf/DEV-22
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/23
requires_validation_hil: false
requires_review_hil: false
---
- Header and footer in the story modal must be sticky
- Header and footer must always be visible, center content should scroll

## Refinement

### Outcome
In the Story modal (the new/edit Story dialog, `StoryEditor`), the header (Story key or "New Story on <Board>" plus the Stage/branch description) stays pinned at the top and the footer (delete trash icon, Cancel, Save/Create/Retry) stays pinned at the bottom. When the content is taller than the viewport, only the middle section scrolls. Today the whole `DialogContent` scrolls (`max-h-[90svh] overflow-y-auto`), so the header and the Save button scroll out of view.

### Scope
In:
- Change the layout of `StoryEditor` so the dialog is a fixed-height-capped column: header, then a scrollable body, then the footer.
- The scrollable body holds everything between header and footer: the dependency-wait notice, HIL notice, legacy-model alert, ModelSelector, Details/Custom Fields tabs, and attachments.
- The close (X) button stays visible in the top-right corner and does not overlap scrolling content.
Out:
- Other dialogs (Board Settings, AlertDialogs such as delete confirmation) and the shared `components/ui/dialog.tsx` defaults. Use className overrides in `StoryEditor` rather than changing the shared primitive's behavior for every dialog.
- Any functional change to fields, saving, attachments, or deletion.

### Acceptance Criteria
- [ ] With a Story whose content is taller than the viewport (for example a long body in Preview, many custom fields, or many attachments), the header and footer stay visible while the middle section scrolls on its own.
- [ ] `DialogContent` itself no longer scrolls; the dialog height stays at or below `90svh` and the scroll region is the only element with `overflow-y-auto`.
- [ ] When the content is short, the dialog shrinks to fit (no forced full height and no empty gap).
- [ ] The footer buttons keep working: Enter / Save submits the form, Cancel closes, and the trash icon opens the delete confirmation. Disabling during submit, delete, or retry-only still disables the body's inputs.
- [ ] The X close button stays visible and clickable while scrolling.
- [ ] Focus outlines and the textarea/select controls in the body are not clipped horizontally. The body may need small padding to offset `overflow` clipping of focus rings.
- [ ] Works in both the new-Story and edit-Story modes, at mobile widths (footer stacks via `flex-col-reverse`) and on desktop.
- [ ] `pnpm` typecheck, lint (biome), and tests pass.

### Touch Points
- `src/web/components/StoryEditor.tsx`: the `DialogContent` className (e.g. `flex max-h-[90svh] flex-col overflow-hidden`), the `<form>` (make it `flex min-h-0 flex-1 flex-col`), moving `DialogHeader` out of the `fieldset`, and wrapping the middle content in a scroll container (`min-h-0 flex-1 overflow-y-auto`) that holds the `fieldset`. `DialogFooter` stays a direct child of the form, after the scroll container.
- Possibly no changes to `src/web/components/ui/dialog.tsx`; the shared `grid` default is overridden via `cn`/tailwind-merge.

### Assumptions
- "Story modal" means `StoryEditor` (opened from `App.tsx`) for both creating and editing Stories.
- "Header" is the `DialogHeader` (title and description). The dependency/HIL notices and ModelSelector belong to the scrolling center content.
- "Sticky" means pinned via a flex column layout with a scrolling middle region. `position: sticky` inside a scrolling dialog is not required. Either approach meets the criteria as long as header and footer never scroll out of view.
- The `fieldset disabled` wrapper only needs to cover the form inputs, so it can move inside the scroll region without changing behavior (the header has no inputs, and the footer buttons already manage their own `disabled`).
- A subtle divider (border) between header/body/footer is optional and left to the developer.
- No automated UI test exists for the web components; verification is manual/screenshot in validation.

### Follow-ups
None.
