---
title: 'BUG: "New Story" should be at bottom of the list'
stage: done
branch: sf/DEV-25
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/29
requires_validation_hil: false
requires_review_hil: false
---
- The "New Story" button should be sticky to the bottom of the list.

## Refinement

### Outcome

Each configured Stage keeps its New Story action visible at the bottom of its list while the user browses Stories, including when that Stage contains more cards than fit in the available Board height.

### Scope

In: Board Stage layout and scrolling, the per-Stage New Story footer, and documentation of its placement.
Out: Story creation API or dialog redesign, the application header New Story action, changes to Story ordering, or changes to Stage configuration.

### Acceptance Criteria

- [ ] Every configured Stage, including Backlog, Done, and empty Stages, has one New Story action anchored at the bottom of the available Stage column. Short and empty lists leave space above the action rather than placing it immediately below the last card.
- [ ] For an overflowing Stage, its cards can scroll vertically while its New Story action remains visible and usable at the bottom. The action has an opaque surface and reserved space so it does not obscure the final card; every card remains reachable.
- [ ] Mixed empty, short, and overflowing Stages work together within the available Board viewport height. Narrow or short viewports retain access to cards and actions, and horizontal scrolling still reaches all Stages without introducing document overflow beneath the application footer.
- [ ] Clicking a Stage's action still opens a fresh New Story dialog with that Stage selected, and its accessible name remains `New Story in <Stage name>`. Keyboard focus and activation work, including after scrolling.
- [ ] The header New Story action still defaults to Backlog; the synthetic Unknown Stage group still has no create action and all of its cards remain reachable. Existing Story opening and drag/drop Moves between Stages continue to work.
- [ ] Validate the layout in a running browser with mixed empty, short, and overflowing Stages at a normal desktop size and a narrow/short size. Capture evidence before and after scrolling an overflowing Stage; static markup assertions alone cannot establish sticky placement. Keep the existing BoardView behavior coverage passing and update the core spec to state the footer behavior.

### Touch Points

- `src/web/components/BoardView.tsx`: current columns use content height (`items-start` on the Board), map cards directly into each section, and append the creation button in normal flow. Establish bounded Stage height and a scrolling cards region with a persistent bottom action (or an equivalent layout).
- `src/web/App.tsx`: inspect the enclosing flex/overflow containers when validating viewport height; adjust only if needed for the Board layout.
- `test/board-view.test.ts`: retain named per-Stage buttons, card-before-action order, and Unknown Stage coverage.
- `docs/specs/01-core-function.md`, Story section: extend the existing per-Stage creation-button requirement with bottom anchoring and overflow behavior.

### Assumptions

- "New Story" refers to the per-Stage buttons after the cards, since the separate header button is outside the lists.
- "Sticky to the bottom" means the bottom of the visible Stage area, with columns using the available Board height and overflowing cards scrolling above the action. This also aligns actions across short and empty lists.
- This is a focused UI fix with no prerequisite Stories or delivered changes to reconcile; current dependencies and HIL fields are empty.

### Follow-ups

None.
