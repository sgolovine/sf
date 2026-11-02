---
title: Merge "board settings" and "project settings"
stage: done
branch: sf/DEV-30
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/32
requires_validation_hil: false
review_rounds: 1
validation_rounds: 1
requires_review_hil: false
---
- Merge both into where board settings is currently located.

- Show a section at the top of the sidebar for project level settings.

- Section at the bottom to show board level settings

## Refinement

### Outcome

Users manage Project and selected Board settings in one Settings screen at the current Board Settings location. Its secondary navigation groups Project settings first and Board settings second, making scope explicit.

### Scope

In: consolidate the two settings views and their navigation; reuse all existing settings forms; retain Board context; support narrow screens and Projects without Boards; update the documented navigation.

Out: new configuration fields, persistence/API/CLI/schema changes, changes to model inheritance or scheduling rules, redesigning settings forms, or adding URL routes for settings.

### Acceptance Criteria

- [ ] The existing Board Settings gear opens the unified Settings screen (header, tooltip, and accessible name identify it as Settings). It initially selects Board → Stages, preserving the current entry behavior. The Board view's Stages shortcut still opens that section directly.
- [ ] The settings secondary sidebar has two clearly labeled groups in order: Project (Worker, Scheduling), then Board (Worker, Stages, Custom Fields, Stage Prompts). The Board group identifies the selected Board by name. The groups are stacked in navigation order; no viewport-bottom pinning is required.
- [ ] Project → Worker renders the existing Project model/default and custom model catalog form; Project → Scheduling renders the existing scheduling form. Board sections render the current Board forms. Project Worker and Board Worker have distinct selection identities and clear scope in their content headings.
- [ ] There is no separate Project settings screen. Replace the global sidebar's Project settings entry with Settings, opening the same unified screen at Project → Worker. This entry works with zero Boards: Project sections remain usable, Board sections are omitted, and New Board remains accessible.
- [ ] Opening Project sections from a Board retains that Board context. Back to board is available from every settings section when a Board exists and returns to that Board. Selecting another Board from the global sidebar continues to open that Board's normal view; entering settings subsequently targets that Board. Board form state does not leak between Boards.
- [ ] At narrow widths, the existing compact section selector includes the same sections grouped/labeled by Project and Board, with the Board group omitted when unavailable. Desktop navigation and compact selection stay synchronized, expose an accessible selected state, and support keyboard operation without horizontal page overflow.
- [ ] Saves still target the correct Project or Board through the current APIs. Persisted values appear after the existing live refresh and after reload/reopening settings; errors remain visible and failed saves retain editable inputs. Model inheritance/catalog behavior, scheduling validation, and all existing Board operations remain intact.
- [ ] Update docs/specs/01-core-function.md references describing separate Project settings and Board Settings navigation to describe the unified screen. Settings remain in-memory views without new URL paths.
- [ ] Validate with pnpm check and pnpm test, plus browser checks at wide and narrow widths covering both navigation groups, Project and Board save targets, return navigation, multiple Boards, and zero Boards. Capture screenshots of the unified wide and compact navigation for validation.

### Touch Points

- src/web/App.tsx: View state, settings entry points, selected Board context, header/back action, and rendering currently split between project-settings and settings.
- src/web/components/BoardSettings/BoardSettings.tsx: unified section identities, grouped secondary navigation, responsive selector, and Project content (rename/restructure if useful).
- src/web/components/AppSidebar.tsx: unified Settings entry.
- src/web/components/ModelSettings.tsx: scope-specific content headings if needed; retain Project versus Board save behavior.
- src/web/components/SchedulingSettings.tsx and existing BoardSettings tabs: reuse existing forms and persistence/remount conventions.
- docs/specs/01-core-function.md: settings navigation description (including in-memory view terminology).

### Assumptions

- “Sidebar” means the existing secondary sidebar inside Board Settings, rather than reorganizing the global Boards sidebar.
- “Top” and “bottom” mean Project group followed by Board group in that sidebar, rather than placing the Board group against the viewport bottom.
- Project forms become separate Worker and Scheduling sections, matching the current controls and existing Scheduling terminology.
- Keep the global settings entry to support Project access without any Board; both entry points lead to the same screen with a useful initial section.
- This is a bounded UI consolidation suitable for one PR, with no dependency on other Stories and no new settings capabilities.

### Follow-ups

None.
