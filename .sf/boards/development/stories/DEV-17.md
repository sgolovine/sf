---
title: Settings Updates
stage: done
branch: sf/DEV-17
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/18
requires_validation_hil: false
review_rounds: 1
requires_review_hil: false
---
- Header button should be on the right.
- Use a secondary sidebar instead of header tabs for sections
- To re-arrange items, use a handle on the left hand side instead of an up arrow / down arrow.

## Refinement

### Outcome

Board Settings has a right-aligned return action, a secondary navigation sidebar for its sections, and left-hand drag handles for arranging Stages.

### Scope

In: Board Settings layout and section navigation; placement of its Back to board header button; reordering the existing movable Stages through handles.

Out: new settings sections; Project settings redesign; Story editor tabs; custom-field, model-catalog, Board, or Story reordering; changes to Stage data formats, Worker dispatch, or CLI/API contracts.

### Acceptance Criteria

- [ ] In Board Settings, Back to board is aligned to the right edge of the application header. The sidebar toggle and Board Settings title remain on the left. The return action still opens the same Board and retains an accessible name when its text is hidden.
- [ ] Replace the horizontal Board Settings tab strip with a secondary vertical navigation area beside the section content, distinct from the primary application sidebar. It contains Worker, Stages, Custom Fields, and Stage Prompts in the current order, visibly identifies the selected section, and supports keyboard selection with appropriate accessible navigation/selection semantics.
- [ ] Every existing section remains reachable and retains its current forms, save behavior, validation, and live refresh behavior. Opening Board Settings from the header gear or a Board column title still selects Stages. Returning to the Board and switching Boards still work.
- [ ] The settings navigation and content remain usable at desktop and narrow/mobile widths, including when the primary sidebar is open or collapsed. A compact or collapsible secondary sidebar is acceptable on narrow screens; section choices and actions must remain reachable without overlapping content.
- [ ] Each movable Stage row has an identifiable reorder handle at its left edge, before its editable content. The up/down reorder buttons are removed. Starting a drag on the handle allows placing that Stage before or after another movable Stage, with a visible destination indication. Editing a name, selecting HIL fields, and using other row controls do not start a drag.
- [ ] Reordering works with pointer input, including touch, and with the keyboard through the focused handle. Provide an accessible handle name and discoverable keyboard instructions; allow cancellation without saving and keep focus on the moved Stage's handle after a keyboard move. Keyboard reordering may use arrow keys without adding visible up/down buttons.
- [ ] Backlog remains first and Done remains last. Neither fixed Stage has an active reorder handle, and neither pointer nor keyboard interaction can move another Stage outside those boundaries. Lists with zero or one movable Stage remain usable.
- [ ] A completed reorder persists through the existing sfApi.reorderStage(boardId, stageId, index) operation. After server refresh/reload, both Settings and the Board show the saved order. No-op or cancelled drags make no reorder request. Failed saves surface through the existing error banner and leave or restore the server's saved order.
- [ ] Validation demonstrates section navigation, the header alignment, pointer/touch and keyboard reordering, fixed boundaries, cancellation, persistence, and failed-save behavior. Capture screenshots of the updated settings layout at desktop and narrow widths, and run the repository checks appropriate to the implementation.

### Touch Points

- `src/web/App.tsx`: application header and Board Settings entry/return behavior.
- `src/web/components/BoardSettings/BoardSettings.tsx`: replace the horizontal section strip with secondary sidebar navigation and responsive content layout.
- `src/web/components/BoardSettings/StagesTab.tsx`: movable Stage rows, handles, reorder interaction, focus, and feedback.
- `src/web/components/BoardSettings/fixed.ts`: existing fixed-Stage identifiers.
- `src/web/api/client.ts` and `src/server/project/service.ts` (`reorderStage`): existing persistence path and valid destination indexes, expected to be reused without a contract change.
- `src/web/components/ui/` and `src/web/index.css` as needed for existing primitives and styles; `package.json` only if a focused drag-and-drop dependency is needed.
- `docs/specs/01-core-function.md`: update the description of Board Settings navigation from a Worker tab to a section, and document handle-based Stage ordering if appropriate.

### Assumptions

- “Header button” means Back to board on the Board Settings screen: it is currently placed immediately after the title, while the Board screen's New Story and settings actions already sit on the right. This does not move the sidebar toggle.
- “Sections” means the four existing Board Settings tabs. Project settings currently has one form and needs no additional sidebar sections.
- “Items” means Stages, the only settings list currently offering up/down reorder arrows. Adding reorder capability to other lists is outside this Story.
- Preserve the existing default section, section order, and form lifecycle when replacing the navigation. No new guarantee of retaining unsaved values across section switches is introduced.
- Stage order continues to save on a completed move rather than requiring a new Save button. A small drag-and-drop library is acceptable if needed for touch and keyboard support; its choice belongs to development.
- These changes form one reviewable UI Story. No dependency or separate human decision is needed.

### Follow-ups

None.
