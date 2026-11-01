---
title: Story URL's
stage: done
branch: sf/DEV-19
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/22
validation_rounds: 1
requires_validation_hil: false
requires_review_hil: false
---
- When creating a story, modal should map to a URL like `/create`

- When editing a story, the URL should be `/<STORY_ID>`

## Refinement

### Outcome
The Story dialog in the web UI is addressable by URL. Opening "New Story" changes the address bar to `/create`, and opening an existing Story changes it to `/<STORY_KEY>` (for example `/DEV-19`). Closing the dialog returns the URL to `/`. Loading, reloading, or pasting one of these URLs opens the matching dialog, and the browser Back/Forward buttons open and close it.

### Scope
In:
- Client-side path routing for the Story dialog only: `/` (no dialog), `/create` (new Story on the current Board), `/<STORY_KEY>` (edit that Story).
- Deep links and reload: on load, read `location.pathname` and open the matching dialog. For `/<STORY_KEY>`, select the Board that contains the Story.
- History integration: opening the dialog pushes a history entry, closing it (Cancel, Escape, overlay click, after Create/Save, or after Delete) navigates to `/`, and `popstate` (Back/Forward) syncs the dialog to the URL.
- Unknown or invalid paths (for example `/DEV-9999`, `/foo`) show no dialog and are replaced with `/` (`history.replaceState`). The editor must never fall back to create mode for an unknown key.
- If the open Story disappears (deleted elsewhere), close the dialog and go to `/`.

Out:
- URLs for Boards, Board Settings tabs, Project settings, or New Board. These stay as in-memory state. A possible follow-up.
- Board-scoped create URLs (for example `/DEV/create`). `/create` uses the currently selected Board.
- Adding a router dependency.
- Server changes. `uiRouter` in `src/server/routes/ui.ts` already serves `index.html` for every non-`/api` path, and Vite's dev server has an SPA fallback.

### Acceptance Criteria
- [ ] Clicking "New Story" sets the URL to `/create` and opens the create dialog for the current Board.
- [ ] Clicking a Story card sets the URL to `/<STORY_KEY>` and opens that Story's editor.
- [ ] Closing the dialog by any route (Cancel, Escape, overlay, after Create Story, Save, or Delete) sets the URL to `/`.
- [ ] Loading `/<STORY_KEY>` directly (fresh tab or reload) opens that Story's editor with its Board selected in the sidebar, including a Story on a Board other than the first.
- [ ] Loading `/create` directly opens the create dialog on the default Board (the first Board). With no Boards, the New Board view shows and the URL is replaced with `/`.
- [ ] Browser Back after opening a dialog closes it, and Forward reopens it.
- [ ] An unknown key or unrecognized path shows no dialog and the URL becomes `/`. It never opens the create form.
- [ ] Switching Board, opening Board Settings, Project settings, or New Board while a dialog URL is active resets the URL to `/`.
- [ ] The first-load auth token in the fragment still works with a path: `http://host:port/DEV-19#authToken=…` authenticates, strips the fragment, and opens DEV-19. The existing `history.replaceState` in `src/web/api/client.ts` preserves `location.pathname`.
- [ ] `pnpm check` and `pnpm test` pass. If URL parsing is extracted into a pure helper (recommended: `parseStoryPath(pathname)` → `{ kind: "none" } | { kind: "create" } | { kind: "edit", key }`), it has a unit test under `test/`.

### Touch Points
- `src/web/App.tsx`: the `editing` state becomes derived from or synced with `location.pathname`. Add a `popstate` listener, push or replace on open and close, resolve the Board from the Story key on deep link, and reset the URL in `openBoard`, `openSettings`, and the other view switches. Update the "Navigation is plain state" comment.
- Possibly a small new helper module in `src/web/` (for example `src/web/lib/storyRoute.ts`) for parsing and building paths, plus a test in `test/`.
- `src/web/components/StoryEditor.tsx`: probably unchanged. It already calls `onClose` after submit and delete.
- No changes in `src/server/routes/ui.ts` or `vite.config.ts` (verify the fallback still serves `/DEV-19` and `/create`).

### Assumptions
- "STORY_ID" means the Story Key (for example `DEV-19`). Keys match `^[A-Z][A-Z0-9]*-\d+$` (`src/server/project/story.ts`), so `/create` cannot collide with a key.
- Paths are case-sensitive: `/dev-19` is unknown and goes to `/`.
- Path-based routing (not hash), because the fragment carries the one-time `authToken` and the server already has an SPA fallback.
- `/create` is not Board-scoped. It uses the Board selected in memory, which is the first Board after a reload.
- Opening a dialog uses `pushState` and closing uses `pushState('/')` (or `history.back()` when the previous entry is the app's own `/`). Either is acceptable if Back/Forward behave as stated above.
- While the session is still loading, deep-link resolution waits until Boards are available, so a valid key is not treated as unknown too early.

### Follow-ups
None created. Board and Settings URLs can be filed separately if wanted.
