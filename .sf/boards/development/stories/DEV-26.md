---
title: Scroll inside columns.
stage: done
dependsOn:
  - DEV-25
branch: sf/DEV-26
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/34
requires_validation_hil: false
requires_review_hil: false
---
- Columns should max out at the height of the viewport
- The list inside of the column should scroll
- The "New Story" button should not overflow and should be visible at the bottom of the list. Make it sticky to the bottom

## Refinement

### Outcome

Users can browse each Stage's Stories within the available Board viewport while its header and New Story action remain visible. Long lists scroll independently without stretching the Board beneath the application footer.

### Scope

In: reconcile DEV-25's delivered layout, verify viewport bounds and independent Stage scrolling, and fix any remaining layout gaps. Include empty, short, overflowing, and Unknown Stage lists.
Out: redesigning cards, creation dialogs, Story ordering, Stage configuration, or application navigation.

### Acceptance Criteria

- [ ] Start development by incorporating the current base branch containing DEV-25, then assess the delivered behavior before making changes. Do not recreate the pre-DEV-25 implementation from this older Story Worktree. If all criteria already pass, report the evidence and avoid redundant source changes.
- [ ] Stage columns fit the available Board area below the application header and above the application footer, including Board padding and any horizontal scrollbar. Increasing Story count does not increase column height or introduce document scrolling beneath the footer.
- [ ] Each overflowing Stage scrolls its own card list independently. Its header and New Story action stay visible while scrolling from first to final card; cards retain readable height, and the final card is fully reachable without being covered by the action.
- [ ] Every configured Stage, including Backlog, Done, empty and short Stages, keeps one New Story action at the bottom of the visible column with spare space above it. An opaque footer outside the scrolling cards is acceptable; literal CSS position: sticky is not required.
- [ ] Horizontal Board scrolling reaches all Stages on narrow screens. Unknown Stage uses the same bounded card scrolling but has no creation action. Resizing the viewport updates the available column height; test a short viewport explicitly against the delivered min-h-48 column rule and remove or adapt it if it forces overflow.
- [ ] The per-Stage action retains its accessible name and selected Stage, supports keyboard focus/activation after scrolling, and opens a fresh creation form. Story opening and drag/drop Moves between Stages still work.
- [ ] Verify in a running browser with mixed empty, short and overflowing Stages at desktop and narrow/short viewport sizes, including at least 1280x800 and 390x400. Capture before/after scrolling evidence and check column/footer bounds, independent scroll positions, final-card visibility, and horizontal access. Retain existing BoardView behavior tests; update focused tests and the core spec only where the remaining fix changes the behavior or contract. Static class assertions alone do not establish viewport behavior.

### Touch Points

- `src/web/components/BoardView.tsx`: DEV-25 introduces cardsClass with min-h-0/flex-1/overflow-y-auto, a non-scrolling shrink-0 action, and stretched columns. Inspect its min-h-48 and the Board's overflow-auto behavior for remaining viewport gaps.
- `src/web/App.tsx`: h-svh SidebarInset, min-h-0 flex content scroller, header/error banner and footer determine the actual available height. Adjust enclosing sizing only if browser evidence requires it; preserve settings scrolling.
- `test/board-view.test.ts`: DEV-25 already adds scroll-region markup assertions; preserve creation and Unknown Stage coverage.
- `docs/specs/01-core-function.md`, Story section: DEV-25 already documents full-height columns, scrolling cards, and anchored actions; reconcile only if needed.

### Assumptions

- "Viewport" means the available Board viewport within the existing application shell, rather than assigning each column the entire window height.
- "Sticky" describes persistent visibility at the bottom of the column; a flex footer outside the list satisfies it and avoids covering cards.
- DEV-25 is Done and delivered in merge commit 270c8855ff6f721871bd29c368d73bc128004413 (PR #29). Both this Story Worktree and the Supervisor checkout currently precede that merge, while origin/main contains it. Its implementation overlaps this Story substantially; remaining changes must be justified by verification after incorporating it.
- No human decision is needed, and the existing DEV-25 dependency remains recorded and satisfied.

### Follow-ups

None.
