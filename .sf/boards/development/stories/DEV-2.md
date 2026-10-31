---
title: Allow deletion of a story
stage: done
branch: sf/DEV-2
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/6
requires_validation_hil: false
review_rounds: 1
requires_review_hil: false
---
There is no way to delete a story. After deletion, there should be a trash icon in the modal when you go to open a story

## Refinement

### Outcome

A user can open an existing Story, click a trash icon, confirm deletion, and see the Story disappear from its Board. The same operation is available through the sf CLI and shared HTTP/service layer.

### Scope

In: permanent deletion of one Story, an accessible confirmation flow in the existing Story modal, a shared service operation, HTTP and online/offline CLI support, removal of obsolete runtime scheduling/status for the Story, and durable prevention of Story Key reuse.

Out: trash/recycle-bin screens, restore/undo, bulk deletion, deleting Boards, cancelling external agent threads, and automatic removal of git branches or Story Worktrees. Keep any existing worktree and branch intact; explain this in the confirmation and command documentation.

### Acceptance Criteria

- [ ] Opening an existing Story in any Stage shows a trash icon button with an accessible name identifying deletion. The new-Story modal has no delete button. Clicking the icon does not save edits or submit the editor form.
- [ ] Clicking the icon opens a confirmation dialog using the existing AlertDialog convention. It identifies the Story Key/title, says deletion is permanent, and states that any Story Worktree and branch are retained. Cancel or dismiss leaves both the Story and unsaved editor inputs unchanged.
- [ ] Confirming deletes the Story through the shared sf service, closes the Story modal only after success, and removes its card from the live Board. Reopening/reloading the app and listing Stories do not bring it back. Disable repeat confirmation while the request is pending. On failure, show the existing error feedback and preserve the Story/editor contents.
- [ ] Add `DELETE /api/stories/:key` and `sf story delete <KEY>` (including the existing `--project`, `--json`, and `--worker` actor handling). Online CLI calls the HTTP operation; offline CLI uses the same service against the selected Project. The explicit CLI delete command needs no interactive confirmation. Document the command and its permanent/retained-worktree behavior in CLI help and README.
- [ ] Deletion runs under the existing mutation lock. A nonexistent Story returns the existing `not_found` error (HTTP 404), including a repeated delete. Invalid/stale Worker credentials follow the existing `claim_gone` behavior before mutation.
- [ ] Reject deletion whenever the target has a live Claim, including requests from that Claim's own Worker; use the existing `claimed` conflict (HTTP 409), and explain that the Claim must first be released. Expired Claims follow existing timeout processing. This is enforced in the service even if the UI snapshot is stale; do not implicitly force-release or terminate a Worker.
- [ ] Successful deletion removes the active Story Markdown file and its queue entries, pending spawn/cleanup triggers, spawn failure, and worktree warning. No later queue drain, restart, or stale scheduled work may spawn a Worker or recreate the deleted Story. Preserve historical Worker records and unrelated Stories/runtime entries. Do not invoke Done-stage git cleanup or delete any worktree/branch.
- [ ] Story Keys allocated through sf are never reused after deletion, including deletion of the highest-numbered Story or every Story on a Board, service/server restart, and loss of gitignored runtime state. Persist a Board numbering high-water mark in committed Project data, backward-compatible with existing Boards by accounting for the highest existing Story file. Allocate under the existing mutation lock and keep Board namespaces independent.
- [ ] Add focused service/HTTP/CLI tests covering successful deletion and persisted absence, missing/repeated deletion, claimed rejection and stale Worker credentials, queued/pending runtime cleanup, retained worktree/branch, and numbering after highest/all deletion and restart. Verify the UI confirmation, cancel, successful deletion, and failed request behavior in the running app, capturing screenshot evidence for validation. Run the repository checks appropriate to the implementation (`pnpm check`, `pnpm test`, and build for the UI change).

### Touch Points

- `src/web/components/StoryEditor.tsx`: existing create/edit modal and deletion confirmation; `src/web/components/BoardSettings/StagesTab.tsx` supplies the trash-icon/AlertDialog precedent.
- `src/web/api/client.ts`, `src/model/api.ts`, `src/server/routes/stories.ts`: typed delete transport and response contract.
- `src/server/project/service.ts`: shared locked deletion, actor/Claim checks, runtime cleanup, and numbering allocation.
- `src/server/project/story.ts`, `src/model/config.ts`, `src/server/project/config.ts` (and paths if needed): durable backward-compatible numbering; currently `nextStoryNumber` only scans remaining Markdown files.
- `src/cli/story.ts`, `README.md`: online/offline delete command and documentation.
- `test/story.test.ts`, `test/http.test.ts`, `test/cli.test.ts`, `test/offline.test.ts`, `test/claims.test.ts`, and scheduling/worktree tests as appropriate.

### Assumptions

- Interpret the author's phrase “After deletion” as “after implementation”: the trash icon is the entry point in an existing Story's modal, before deletion.
- Deletion permanently removes the active Story file. There is no app-managed recovery feature; committed history remains normal Git history.
- A confirmation matches existing destructive Stage actions. A live Claim blocks deletion until released, avoiding removal underneath an active Worker; Worker self-deletion is not a replacement for Move/release.
- Retaining git artifacts avoids discarding code and keeps this a single reviewable Story. Durable numbering prevents a later Story from inheriting the retained branch/worktree or historical runtime identity.
- CLI parity follows the repository's single shared service and online/offline mutation design. UI confirmation supplies the interactive guard; scripts can use the explicit command directly.

### Follow-ups

None. The UI, service, CLI, and numbering guard form one coherent deletion feature.


## Development handoff

Implemented on `sf/DEV-2`, pushed commits `e405fc9` (service/numbering/CLI/HTTP/tests) and `04b428a` (confirmation UI/docs). Current with `origin/main` (remote default renamed from master).

Validation run: `pnpm check`, `pnpm test` (73 passed), and `pnpm build` passed. Build emits the existing Vite chunk-size advisory.

Running-app checks passed for confirmation text, Cancel and Escape preserving unsaved inputs, deletion and persisted absence after reload, live-Claim rejection preserving editor contents with existing error feedback, and no delete button in new-Story modal. Screenshots on this machine: `/tmp/sf-dev2-evidence/confirmation.png`, `cancel-preserves-title.png`, `escape-preserves-title.png`, `deleted-after-reload.png`, `failed-delete.png`, and `new-story-no-delete.png` in that directory. Collaborative preview snapshots timed out twice; checks used the playwright-browser skill fallback against an isolated disposable Project. Browser and test server stopped after verification.
