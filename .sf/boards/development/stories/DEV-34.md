---
title: Stage column should not automatically extend to the bottom of the screen
stage: in_progress
branch: sf/DEV-34
requires_refinement_hil: false
---
- Stage column should only be high enough to support the content

- Should only be full-height when content takes up that much space

- Should stay at full height when it reaches it.

- Likely will need to use sticky positioning for this.

## Refinement

### Outcome

Each Stage on the Board is only as tall as its header, Story cards, New Story button, gaps, and padding require. It grows to the available Board height, then stays capped there while its cards scroll. A short Stage remains short beside an overflowing Stage.

### Scope

In: Board Stage sizing and overflow behavior, including Backlog, Done, and the synthetic Unknown Stage group; retain accessible Stage creation controls; update the documented layout contract.

Out: Story data, API/CLI changes, Stage ordering, drag-and-drop redesign, saved/manual Stage heights, and new scrolling or animation features.

### Acceptance Criteria

- [ ] Empty and short configured Stages are aligned at the top of the Board and end immediately after their New Story button, allowing only existing layout gaps and padding. They do not stretch to match the viewport or a taller neighboring Stage.
- [ ] Adding cards grows only that Stage until its natural height reaches the available Board content height (excluding application chrome and Board padding). Further cards do not extend its outer height or the document vertically.
- [ ] At that cap, the Story-card region scrolls independently. The Stage header and New Story button stay visible, and every card remains reachable without compressing cards to fit. Scrolling to the last card does not shrink the Stage.
- [ ] Moving/removing cards below the cap lets the Stage shrink back to its current content height. Resizing the viewport recalculates the available height; no historical maximum height is persisted.
- [ ] Unknown Stage uses the same independent content sizing, height cap, and card scrolling, retaining its header and no New Story button.
- [ ] Horizontal Board scrolling still exposes every Stage on narrow viewports. Stage headings, Worker badges, opening cards, dropping a Story onto an empty or populated Stage, and New Story opening with the correct Stage selected continue to work.
- [ ] Update the Stage-height/New Story paragraph in `docs/specs/01-core-function.md` to describe the new behavior. Preserve or adapt `test/board-view.test.ts` coverage for named creation controls and Unknown Stage. Validate the actual browser layout with empty, short, and overflowing Stages side by side, including a narrow/short viewport; static markup tests alone cannot verify sizing.

### Touch Points

- `src/web/components/BoardView.tsx`: Board flex alignment, shared Stage and card-region classes, and the comment currently specifying always-stretched columns. Both configured Stages and Unknown Stage share these classes.
- `src/web/App.tsx`: inspect the fixed-height `SidebarInset` and nested content scroller when establishing the height cap; change only if needed to contain Board overflow.
- `src/web/components/StoryCard.tsx`: inspect flex shrinking if necessary to retain readable card heights; no card content redesign.
- `test/board-view.test.ts`: existing SSR coverage for creation buttons and independent card-scroll regions.
- `docs/specs/01-core-function.md`, Story section: currently explicitly requires full-height Stages and blank space above short Stage footers; this Story intentionally replaces that requirement.

### Assumptions

- “Full-height” means the available Board region under the application header and above its footer, respecting Board padding, rather than the entire browser window.
- “Should stay at full height when it reaches it” means a Stage remains capped while its content requires that height, including while scrolling. It does not require remembering a prior height after cards are removed or a Board is reopened.
- Sticky positioning is a suggested technique, not a requirement. Prefer CSS sizing and the existing independent card-scroll regions if they satisfy the criteria; sticky positioning is only needed if the final layout requires it.
- Preserve the existing visible header and creation footer for overflowing Stages. Empty Stages remain valid drop targets within their compact section; no invisible full-height drop area is required.

### Follow-ups

None. This is one focused layout change with no prerequisite Stories or delivered changes to reconcile.
