---
title: Dark theme
stage: done
branch: sf/DEV-23
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/24
requires_validation_hil: false
review_rounds: 1
requires_review_hil: false
---
- Add dark theme to app

## Refinement

### Outcome
A user of the sf web UI (`sf start`) can choose Light, Dark, or System appearance. The choice persists in that browser across reloads, System follows the OS `prefers-color-scheme` (including live changes), and every screen (Board view, Story editor, Board settings, Project settings, sidebar, dialogs/sheets, footer) is legible in dark mode.

### Scope
In:
- A theme preference (`light` | `dark` | `system`, default `system`) stored in browser `localStorage`, applied by toggling the `dark` class on `<html>`.
- A theme control in the sidebar footer (`AppSidebar`), e.g. a button/select cycling or picking Light / Dark / System with lucide icons (Sun / Moon / Monitor).
- Applying the stored theme before React renders (small inline script in `src/web/index.html`, or equivalent in `main.tsx` before `createRoot`) so there is no light flash on reload in dark mode.
- Fixing hard-coded light-only colors so they read correctly in dark mode: `StoryCard.tsx` status pills (`bg-amber-50 text-amber-900`, `bg-blue-50 text-blue-900`, `bg-red-50 text-destructive`) and the HIL notice in `StoryEditor.tsx` (`border-amber-300 bg-amber-50 text-amber-900`) — add `dark:` variants (e.g. `dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800`).
- `color-scheme` set to match (so native scrollbars/form controls go dark).

Out:
- Storing the theme in `.sf` Project/Board config or on the server (it is a per-browser viewing preference, not factory state).
- New color palettes or redesigning the existing light/dark tokens.
- Theming anything outside the web UI (CLI output).

### Acceptance Criteria
- [ ] The sidebar footer has a theme control offering Light, Dark, and System; the current choice is visibly indicated.
- [ ] Choosing Dark adds `dark` to `document.documentElement`; Light removes it; System matches `window.matchMedia("(prefers-color-scheme: dark)")` and updates when the OS setting changes without a reload.
- [ ] The choice is saved in `localStorage` and restored on reload; with no saved value the UI follows System.
- [ ] Reloading with Dark selected shows no flash of the light theme (class applied before first paint).
- [ ] Status pills on Story cards and the HIL notice in the Story editor have readable contrast in dark mode; no remaining light-only `bg-*-50`/`text-*-900` classes in `src/web` outside `components/ui` lack a `dark:` counterpart.
- [ ] No `.sf` file or server API changes; `pnpm` typecheck, lint (biome), and tests pass.
- [ ] Validation includes screenshots of the Board view and Story editor in both light and dark.

### Touch Points
- `src/web/index.html` (pre-paint theme script) and/or `src/web/main.tsx`
- New small module, e.g. `src/web/hooks/use-theme.ts` (read/write preference, apply class, matchMedia listener)
- `src/web/components/AppSidebar.tsx` (theme control in `SidebarFooter`)
- `src/web/components/StoryCard.tsx`, `src/web/components/StoryEditor.tsx` (dark variants)
- `src/web/index.css` (`color-scheme` for `:root`/`.dark`, if not done via script). Dark tokens and `@custom-variant dark` already exist there.

### Assumptions
- "App" means the sf web UI under `src/web`; the CLI is unaffected.
- Three-way Light/Dark/System with System as default, matching common shadcn practice; no `next-themes` dependency — a tiny hook is enough.
- Preference is per browser (`localStorage`, key such as `sf-theme`), not per Project, since it is a viewer preference and `.sf` holds factory state.
- Existing shadcn `.dark` token values in `index.css` are acceptable as the dark palette.
- If an inline script in `index.html` conflicts with how `src/server/routes/ui.ts` / the Vite build serve the page, apply the class synchronously in `main.tsx` before rendering instead.

### Follow-ups
None.
