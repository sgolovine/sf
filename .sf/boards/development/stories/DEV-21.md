---
title: Show version in UI
stage: done
branch: sf/DEV-21
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/21
requires_validation_hil: false
requires_review_hil: false
---
- Show current app version in UI, refer to screenshot for placement.

## Refinement

### Outcome
The web UI footer shows the running sf version (for example `sf v0.1.0`) right-aligned at the far right of the footer bar, opposite the Workers count and Supervisor status. The screenshot attachment (`image.png`) marks this spot in the bottom-right corner of the footer. The version shown is the same one `sf --version` prints, because both come from `package.json`.

### Scope
In:
- Add a `version: string` field to the session state (`SessionState` in `src/model/session.ts`). The server fills it from `package.json` `version` when it creates the Store (`StoreService.create`, `src/server/services/StoreService.ts`), using the JSON import `src/cli/main.ts` already uses (`import pkg from "../../package.json" with { type: "json" }`).
- Render it in the `<footer>` in `src/web/App.tsx`: push it right with a flex spacer (`ml-auto` or `<span className="flex-1" />`), mark it `shrink-0`, and keep the existing `text-xs text-muted-foreground` styling.
- Add a test asserting `GET /api/state` (or the SSE state) includes `version` equal to `package.json` version.

Out:
- Update checks or notices that a newer version exists.
- Showing the version anywhere else (sidebar, settings, About dialog).
- Persisting the version in `.sf` session files (it is derived on each start and need not be written to the session file).
- Git SHA or build metadata.

### Acceptance Criteria
- [ ] `SessionState` has a `version` field, and the server sets it to `package.json` `version`.
- [ ] The footer shows `sf v<version>` right-aligned in the footer bar on every view (board, Board Settings, Project settings, New Board).
- [ ] The version text uses the footer's muted `text-xs` style. It does not shrink or truncate when the main area is narrow: the Supervisor text truncates first.
- [ ] Under `pnpm dev` (Vite + `tsx watch`) and after `pnpm build` / `sf start`, the UI shows the same value as `sf --version`.
- [ ] A test in `test/` checks that the session state served over HTTP includes the `package.json` version.
- [ ] `pnpm check` and `pnpm test` pass.

### Touch Points
- `src/model/session.ts`: `SessionState.version`
- `src/server/services/StoreService.ts`: set `version` in `create`
- `src/web/App.tsx`: footer
- `test/http.test.ts` (or a similar test that already starts the server)

### Assumptions
- "Placement" means the empty right end of the footer status bar, which the orange box in the attached screenshot marks.
- The version comes from the server's session state, not a Vite `define` at build time. The server is what is actually running, and this works the same under `pnpm dev` and production builds without changing the Vite config.
- Display format: `sf v0.1.0`. A `title` tooltip is optional.
- The version stays out of the persisted session file (`StoreService` write at line ~143 already picks fields explicitly).

### Follow-ups
None.
