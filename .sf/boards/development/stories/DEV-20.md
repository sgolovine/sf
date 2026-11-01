---
title: Story Search
stage: done
dependsOn:
  - DEV-19
branch: sf/DEV-20
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/25
requires_validation_hil: false
review_rounds: 1
requires_review_hil: false
---
- Add search bar to the header
- When clicked, opens up a finder modal (similar to finder on MacOS or the fuzzy finder in VSCode)
- Allows fuzzy search of all stories
- Create a `/search` route in backend to do search
- Use `fuzzysort` npm package
- When items are found, they display in a list in the finder modal.
- Clicking on a story takes you directly to that story via the URL (url implementation part of DEV-19)

## Refinement

### Outcome
The web UI header has a search button that looks like a search bar. Clicking it, or pressing Cmd/Ctrl+K, opens a finder dialog with a text input. Typing fuzzy-matches Stories across every Board in the Project through a new backend endpoint, `GET /api/search?q=<text>`, which uses `fuzzysort`. Matches show as a ranked list with each Story's key, title, Board, and Stage. Clicking a result, or picking it with the arrow keys and pressing Enter, closes the finder and goes to `/<STORY_KEY>`. DEV-19's routing then selects the Story's Board and opens its editor.

### Scope
In:
- Add `fuzzysort` as a runtime dependency. esbuild bundles it into `dist/sf.mjs`.
- Backend: a `search` route mounted at `/api/search` behind the existing token check. Add `routes.search` to `src/model/api.ts`. Add a typed response (`SearchResponse` / `SearchResult`) and a Service method, for example `searchStories(query, limit)`, that runs `fuzzysort.go` over all Stories in all Boards.
- Search targets: Story key and title. Multi-key fuzzysort, ranked by the best key score.
- Result shape: `{ key, title, board: { id, name }, stage: { id, name } }`, best match first, capped at 50.
- Frontend: `sfApi.search(q)`, a `SearchDialog` component built on `components/ui/dialog.tsx` plus `Input`, and a header trigger in `App.tsx`.
- Keyboard: Cmd/Ctrl+K opens the finder (when the app has Boards). Up/Down move the highlighted result, Enter opens it, Escape closes. The input is focused on open, and each opening starts with an empty query.
- Selecting a result calls the existing `navigate({ kind: "edit", key })` (a history push), so Back closes the Story again.

Out:
- Searching Story bodies, custom field values, or attachments. A possible follow-up; bodies make fuzzy ranking noisy.
- A `/search` page URL in the web UI. The finder dialog has no URL.
- A CLI `sf search` command.
- Highlighting matched characters. Nice to have but optional (`fuzzysort` result `.highlight()` may be used if trivial).
- Filters by Board or Stage.

### Acceptance Criteria
- [ ] `fuzzysort` is listed in `package.json` `dependencies`, and `pnpm-lock.yaml` is updated.
- [ ] `GET /api/search?q=<text>` without the token returns 403, like every other `/api` route.
- [ ] `GET /api/search?q=<text>` returns Stories from all Boards whose key or title fuzzy-match the text. For example, `q=srch` matches a Story titled "Story Search", and `q=dev20` or `q=DEV-20` matches DEV-20. Results are sorted best first, with at most 50 entries, each `{ key, title, board: { id, name }, stage: { id, name } }`.
- [ ] An empty, whitespace-only, or missing `q` returns `[]` with status 200, not an error.
- [ ] The header shows a search trigger (a search icon plus "Search Stories…" placeholder text and a ⌘K/Ctrl K hint, collapsing to the icon on a narrow header) whenever the Project has at least one Board, in the Board view, Board Settings, and Project settings.
- [ ] Clicking the trigger or pressing Cmd/Ctrl+K opens the finder dialog with its input focused. Pressing Cmd/Ctrl+K while a Story dialog or Create a Board is open does nothing.
- [ ] Typing shows the matching Stories as a list. Each row shows the key, title, Board name, and Stage name. A query with no matches shows a "No Stories found" message.
- [ ] Up and Down move the highlighted row, and Enter opens the highlighted Story. The first row is highlighted by default.
- [ ] Clicking a result (or Enter) closes the finder, sets the URL to `/<STORY_KEY>`, selects that Story's Board in the sidebar (including a Board other than the current one), and opens the Story editor. From Board Settings or Project settings it switches to the Board view. Browser Back then closes the editor.
- [ ] Escape, the close button, or an overlay click closes the finder without navigating. Reopening it shows an empty query.
- [ ] Tests: a server test (in `test/http.test.ts` or a new `test/search.test.ts`) covers cross-Board matching, ranking order, the 50-result cap or a smaller limit, the empty-query response, and the token check.
- [ ] `pnpm check` and `pnpm test` pass.
- [ ] `docs/specs/01-core-function.md` gains a short note on the header search and `GET /api/search`.

### Touch Points
- `package.json`, `pnpm-lock.yaml`: add `fuzzysort`.
- `src/model/api.ts`: `routes.search`, plus `SearchResult` / `SearchResponse` types.
- `src/server/routes/search.ts` (new) and `src/server/routes/index.ts`: mount `router.use("/search", searchRouter(service))`.
- `src/server/project/service.ts`: a `searchStories` method that reuses the Board and Story loading behind `listStories` and resolves Board and Stage names.
- `src/web/api/client.ts`: `sfApi.search(q)`. Optionally a `useSearch(q)` hook in `src/web/api/hooks.ts` that uses TanStack Query with `placeholderData: keepPreviousData` so the list does not flash between keystrokes.
- `src/web/components/SearchDialog.tsx` (new): the finder dialog.
- `src/web/App.tsx`: the header trigger, `searchOpen` state, the global Cmd/Ctrl+K listener, and `onSelect={(key) => navigate({ kind: "edit", key })}`.
- `test/search.test.ts` (new) or `test/http.test.ts`.
- `docs/specs/01-core-function.md`.

### Assumptions
- "`/search` route in backend" means `/api/search`, since every backend route lives under `/api` with the token check. A client path `/search` would also conflict with DEV-19's path routing.
- "All stories" means every Story on every Board in the Project, in any Stage including Done.
- Searching matches key and title only, not the body. That keeps fuzzy ranking meaningful, and the body is listed as a possible follow-up.
- Searching runs on the server per keystroke. The server is local, so no debounce is needed, but a short debounce of 100 ms or less is acceptable. A stale response must never replace a newer query's results; keying the query by `q` handles that.
- Cmd/Ctrl+K is added as the keyboard shortcut, following VS Code and macOS convention. The Story only asked for click-to-open.
- The trigger is a button styled like an input, not a live text field in the header. Typing happens in the dialog, as in VS Code's Quick Open.
- Navigation reuses DEV-19's `navigate` and its route effect (merged on `main` in PR #22). This branch currently predates that merge, so development must start from current `main`.

### Follow-ups
None created. Body and field search can be filed separately if wanted.
