---
title: List View
stage: in_progress
branch: sf/DEV-40
requires_refinement_hil: false
---
- When viewing a board, support a list view. Segment by stage, allow expanding / collapsing of stages.

- Allow drag and drop between stages

- Allow fast switching via header when viewing a board.

## Refinement

### Outcome
Users can switch the selected Board between its existing column layout and a compact, vertically scrolling List layout, collapse Stage groups, and Move Stories between Stages from the list.

### Scope
In: Board header view selector; grouped List rendering; Stage collapse state; existing Story opening, creation, status/actions and Move behavior in both layouts; focused regression coverage and core-spec documentation.
Out: Story sorting/reordering within a Stage, bulk edits, filtering, configurable table columns, new server APIs or persisted Board schema, and a replacement drag system for the existing column view.

### Acceptance Criteria
- [ ] While viewing a Board, the application header exposes directly selectable Board and List controls with accessible names and a visible/programmatic selected state. Switching takes one activation, preserves the selected Board, and does not navigate away or mutate Stories. Controls are absent from Settings and Executions and remain usable in narrow headers alongside existing actions/search.
- [ ] Board remains the initial default. The chosen layout survives live snapshot refreshes, switching Boards, opening/closing a Story, and visiting Settings/Executions within the current application session. Reload may reset it; no persistence is required.
- [ ] List displays every configured Stage in configured order, including empty Stages, Backlog and Done. Each has its name, current Story count, and existing Worker/no-prompt indication. Stories appear once under their current Stage in snapshot order, as compact full-width rows that wrap long content without requiring horizontal scrolling.
- [ ] Each Stage group has a keyboard-operable disclosure button exposing aria-expanded. Groups start expanded; collapsing hides their Story rows and group creation action while leaving the header/count visible. Collapse state is independent per Board and Stage, survives snapshot refreshes and layout switching during the session, and does not affect the column layout.
- [ ] List rows expose Story key/title, open the existing Story dialog, and retain the current StoryCard runtime information and applicable actions: dependencies and dependency hold, HIL/comment, Claim/force release, remote execution identity, previous execution, queue wait, spawn failure/retry and worktree warning/removal. Refreshes update these and group counts without resetting view/disclosure state. Reuse shared rendering where practical to prevent behavior drift.
- [ ] Each expanded configured Stage offers New Story with that Stage preselected. Header New Story continues to default to Backlog. Unknown-stage Stories appear in an additional collapsible Unknown Stage group after configured Stages, with a count and no creation action or Move destination; they can be dragged to a valid Stage.
- [ ] Dragging a List Story onto another configured Stage, including an empty Stage or a collapsed Stage's header, calls the existing sfApi.moveStory through act and shows the existing error handling. Valid drop targets have visible feedback that clears on leave/drop/end. Successful Moves use refreshed server state for grouping/counts; same-Stage drops, unknown/external drag data, and invalid destinations cause no Move. A drop into a collapsed Stage keeps it collapsed.
- [ ] Existing server Claim restrictions and Worker dispatch/HIL/dependency semantics remain authoritative. A rejected Move leaves the Story in its original Stage and reports the error. Existing column drag/drop, creation, opening and Settings access continue working; provide a distinct Settings affordance if a List Stage name is used for disclosure.
- [ ] Add focused regression coverage consistent with test/board-view.test.ts for both layouts, Stage order/counts, empty/unknown groups and creation/status parity. Verify switching, independent disclosure, valid/invalid/same-Stage drops and rejected Moves interactively or with meaningful interaction tests. Validate narrow viewport and keyboard disclosure/selector operation, plus pnpm check and pnpm test. Update docs/specs/01-core-function.md to describe the new view behavior.

### Touch Points
- src/web/App.tsx: header selector and session view/group state ownership as needed.
- src/web/components/BoardView.tsx: grouped List rendering or delegation to a focused List component; shared grouping/Move behavior.
- src/web/components/StoryCard.tsx: reusable Story information/actions with a compact row presentation.
- src/web/api/client.ts: existing moveStory API only; no new operation expected.
- test/board-view.test.ts and focused additional UI tests if needed.
- docs/specs/01-core-function.md: Board/List and disclosure behavior.

### Assumptions
- “Fast switching via header” means an in-place two-option selector in the application header, not navigation between Boards or a keyboard shortcut.
- A List is a vertically stacked set of Stage sections and compact rows, not a configurable data grid.
- View preference is shared across Boards for the current app session; disclosure state is keyed by Board and Stage and session-only. All groups initially expand. Browser reload persistence is deliberately deferred.
- Pointer drag/drop matches the existing Story Move interaction; touch/keyboard drag support is not added by this Story. Selector, disclosures, Story opening and row actions remain keyboard accessible.
- The existing Move service is sufficient, so there are no prerequisite Stories or delivered changes to wait for. This is one reviewable UI slice.

### Follow-ups
None.
