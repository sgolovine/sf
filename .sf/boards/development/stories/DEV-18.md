---
title: "BUG: Footer in settings is not sticky to the bottom"
stage: done
branch: sf/DEV-18
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/19
requires_validation_hil: false
requires_review_hil: false
---
- May be an issue with footer everywhere
- Observed that in settings, footer is not sticky to the bottom and can be scrolled.

## Refinement

### Outcome
The shared application status footer (Workers count and Supervisor status) remains visible at the bottom of the main viewport while settings or other page content scrolls. Long forms remain fully usable above it.

### Scope
In: Reproduce the reported scrolling behavior in Board Settings and Project settings; correct the shared application shell sizing/overflow behavior as needed; verify all screens using that shell (Board, Board Settings, Project settings, New Board).
Out: Redesigning the footer, changing its status data, pinning form Save buttons or CardFooter elements, changing Story dialog layout, or unrelated settings behavior.

### Acceptance Criteria
- [ ] In Board Settings, check all four tabs (Worker, Stages, Custom Fields, Stage Prompts), including content taller than the available viewport. Scrolling from top to bottom keeps the shared status footer visible at the bottom of the main area, with its position unchanged.
- [ ] Project settings behaves the same with both short content and enough custom model options to overflow the viewport.
- [ ] Short screens/content leave the footer at the viewport bottom; long content scrolls within the content region without moving the application header or footer, introducing a second document-level vertical scrollbar, or covering the last control/content with the footer.
- [ ] Board view retains vertical and horizontal scrolling for overflowing Stories/Stages while keeping the shared footer visible; New Board retains accessible form controls and the same footer placement.
- [ ] Verify a normal desktop viewport, a shorter desktop viewport, and a narrow/mobile viewport with the sidebar closed; expanding/collapsing the desktop sidebar and navigating between settings and Board view do not displace the footer. Text remains contained within the main area.
- [ ] Record browser reproduction and post-fix verification with viewport sizes, scroll behavior, and screenshot evidence. If current source already satisfies the behavior, document that evidence and investigate the reported viewport/runtime conditions before making an arbitrary CSS change.
- [ ] Run the repository checks appropriate to the final change (pnpm check and pnpm test); browser verification must exercise actual layout/scroll behavior rather than relying only on class-name assertions.

### Touch Points
- src/web/App.tsx: shared SidebarProvider/SidebarInset, header, scrollable content wrapper, and status footer. Currently SidebarInset has h-svh/min-w-0, the content wrapper has min-h-0/flex-1/overflow-auto, and the footer has h-8/shrink-0; a comment explicitly describes fixed header/footer intent.
- src/web/components/ui/sidebar.tsx: SidebarProvider has min-h-svh and SidebarInset is a flex column; inspect ancestor sizing and sidebar variants if reproduction implicates them.
- src/web/index.css and src/web/index.html: inspect root/document sizing and overflow only as needed for the confirmed cause.
- src/web/components/BoardSettings/BoardSettings.tsx and its tab components, src/web/components/ModelSettings.tsx, src/web/components/BoardView.tsx, src/web/components/CreateBoard.tsx: representative content/scrolling cases; change only if needed for the shared layout fix.
- Existing checks: pnpm check, pnpm test. Current test suite has no dedicated browser layout regression coverage; use browser measurements and screenshots for this visual behavior.

### Assumptions
- “Footer” means the shared Workers/Supervisor status bar, not a settings card action row.
- “Sticky to the bottom” means persistently visible within the viewport across content scrolling. The implementation may use the existing flex shell; no particular CSS positioning mechanism is required.
- The report potentially affects every screen because the footer is rendered once in App.tsx. One focused shared-layout fix and cross-screen verification fit this Story.
- No dependencies or delivered implementation are listed on the current Story. Code already expresses the intended behavior, but the root cause has not been confirmed in a running browser during refinement.

### Follow-ups
None.
