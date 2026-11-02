---
title: Story search should be in the center of the header.
stage: done
branch: sf/DEV-29
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/30
requires_validation_hil: false
requires_review_hil: false
---
## Refinement

### Outcome
Story search sits in the center of the application header, making it consistently discoverable across Board and settings views.

### Scope
In: Reposition the existing Search Stories trigger in the shared header; preserve responsive behavior, accessible controls, and existing actions.
Out: Changes to search matching, API, finder dialog, navigation, or sidebar layout.

### Acceptance Criteria
- [ ] At desktop widths with sufficient space, the Search Stories trigger is horizontally centered on the main application header (the SidebarInset area, excluding the sidebar), rather than merely centered in the space between unequal left/right controls.
- [ ] Centering holds on the Board, Board Settings, and Project settings views, with the sidebar expanded and collapsed. Existing left-side sidebar toggle/view title and right-side New Story, Board Settings, or Back to board actions remain usable in their applicable views.
- [ ] Narrow headers retain the existing compact icon-only search presentation. Controls do not overlap, get clipped, or introduce horizontal page overflow; long settings titles may truncate. At widths where exact centering would cause collisions, a compact collision-free layout takes priority.
- [ ] Clicking the trigger and Cmd/Ctrl+K still open the existing search dialog with its current keyboard/focus behavior. The accessible Search Stories label and shortcut metadata remain intact; search remains absent when the Project has no Board.
- [ ] Validate the layout visually at representative desktop and mobile widths (for example 1280px and 375px), including settings views and both desktop sidebar states; capture screenshots for validation. Run the repository checks appropriate to the layout changes.

### Touch Points
- `src/web/App.tsx`: shared header currently uses a flex spacer followed by search and right-side actions; reorganize its layout to center search independently of unequal side content.
- `src/web/index.css`: only if utility classes are insufficient for the responsive layout.
- `docs/specs/01-core-function.md`, Story search section: record centered placement and narrow-width fallback.
- `src/web/components/SearchDialog.tsx` and `test/search.test.ts`: existing behavior to preserve; search logic changes are not expected.

### Assumptions
- Center means the visible main header, not the full browser window including the sidebar.
- This is a placement change to the existing trigger, not a request for an inline search input or a redesigned finder.
- Preserve the existing 48px header height, outlined trigger, desktop label/shortcut, compact icon treatment, and view-specific actions.
- No prerequisites or delivered changes were listed in the current Story; this is a standalone refinement.

### Follow-ups
None.
