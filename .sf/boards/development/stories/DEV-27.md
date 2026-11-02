---
title: Add theme switcher to header
stage: done
branch: sf/DEV-27
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/28
requires_validation_hil: false
validation_rounds: 1
requires_review_hil: false
---
Currently no way of switching theme in the app, add a light/dark icon to the header that allows switching.

## Refinement

### Outcome

Users can discover and change the app appearance from the persistent application header, including when the sidebar is closed.

### Scope

In: Replace the sidebar footer Theme picker with a compact header icon button opening Light, Dark, and System choices. Reuse the existing browser preference and theme application behavior.

Out: New color palettes, server/Project theme settings, cross-tab synchronization, or unrelated header redesign.

### Acceptance Criteria

- [ ] A theme icon button is visible at the right end of the application header in Board, Board Settings, Project settings, and the no-Boards view after session load, with the sidebar open or closed.
- [ ] Activating the button opens Light, Dark, and System choices and identifies the selected preference. Selecting a choice applies it immediately and closes the picker.
- [ ] The header shows a sun for the effective light appearance and a moon for effective dark appearance, including when System is selected and the OS appearance changes.
- [ ] Light/Dark selections persist through reload using the existing `sf-theme` localStorage key. System removes the explicit preference, follows OS changes live, and remains the default for missing/invalid saved values. Existing pre-paint theme initialization remains consistent.
- [ ] The trigger has an accessible name such as "Choose theme" and a tooltip. The picker is operable by keyboard, exposes selected state, closes on Escape, and returns focus to the trigger on dismissal.
- [ ] The sidebar footer's old Theme picker is removed, leaving one theme control and one active source of theme application state. The header remains usable at a narrow mobile width without overlap or horizontal overflow caused by the control.
- [ ] Existing theme helper tests pass; any changed resolution logic has focused coverage. Browser verification covers selecting all three preferences, reload persistence, System OS changes, keyboard use, and the header with the sidebar closed at desktop and narrow widths. Capture light and dark screenshots for validation.

### Touch Points

- `src/web/App.tsx`: persistent header and placement beside existing actions.
- `src/web/components/AppSidebar.tsx`: remove the footer ThemePicker and theme-only imports.
- A focused theme picker component, using existing Button/Tooltip and Radix-backed popover conventions (`src/web/components/ui/popover.tsx`); Radix primitives are already available.
- `src/web/hooks/use-theme.ts` and `src/web/lib/theme.ts`: reuse preference persistence/application; expose the effective appearance if needed for the trigger icon and live System changes.
- `src/web/index.html`: preserve the existing pre-paint initialization contract.
- `test/theme.test.ts`: existing preference/resolution coverage.

### Assumptions

- The author's discoverability issue is addressed by moving the existing sidebar control to the main application header. Current source already supports Light/Dark/System in the sidebar.
- An icon-triggered picker preserves the existing System option while providing the requested light/dark icon affordance. The icon represents current effective appearance; choices explicitly name their target appearance.
- Appearance stays a browser-local viewer preference; no `.sf` data or API change is needed.
- This is one bounded UI change with no prerequisite Stories. No theme-specific requirement was found in the current specs/ADRs.

### Follow-ups

None.
