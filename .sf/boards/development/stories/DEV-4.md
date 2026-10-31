---
title: Story attachments
stage: done
branch: sf/DEV-4
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/10
validation_rounds: 2
requires_validation_hil: false
requires_review_hil: false
---
Whenever a story is created/edited, I should be able to add attachments to the story

- Use react dropzone: https://react-dropzone.js.org/
- Allow pasting (CTRL+V) inside the window to auto attach an image from the clipboard.
- Add CLI commands that let agents upload and retrieve attachments from a story, as well as listing attachments in story

## Refinement

### Outcome

Users can attach files while creating or editing a Story, including images pasted anywhere in the open Story editor. Users can reopen the Story to see and download its attachments. Agents can upload, list, and retrieve the same files through sf commands against the Supervisor's Project, whether the server is running or stopped.

### Scope

In: one end-to-end attachment feature spanning persistent Project storage, the shared Story service, authenticated HTTP transport, the Story editor, CLI, Worker Brief command guidance, tests, and documentation. Support arbitrary files through selection/drop and image files through clipboard paste.

Out: deleting or renaming persisted attachments, editing files, remote URLs/cloud storage, folders, inline Markdown insertion, automatic git commits, and attachment displays on Board cards. Removing a file from the unsaved selection is included.

### Acceptance Criteria

- [ ] The new and existing Story dialogs have a labelled attachment area built with `react-dropzone`, allowing multiple files by drag/drop and an accessible file picker. Pending files show their names and sizes and can be removed before Save/Create. Existing attachments remain visible and are not replaced by another upload.
- [ ] While the Story editor is open, a window-level paste handler extracts clipboard image files and adds each image once to that editor's pending selection, including when focus is in a text field. Ordinary text paste continues to work. Clipboard images without a usable filename receive a generated name with an appropriate extension. Pasting outside an open editor does not create attachments; listeners are cleaned up on close.
- [ ] Files are staged locally until Save/Create. Cancel/discard leaves no persisted attachments or new Story. Save/Create is disabled while submitting, and reports upload/validation failures without closing the dialog or losing the entered fields and pending files. Successful save persists all submitted attachments before closing. An unsuccessful attachment submission must not enqueue a Worker or leave a partially created Story; rejected additions must leave an existing Story's attachments intact. If a retry is needed, it must not create a duplicate Story or duplicate already committed attachments.
- [ ] Attachments supplied during Story creation, or during an update that clears HIL, are committed before the corresponding Stage trigger is dispatched. A Worker started by that operation can immediately list and retrieve all submitted files. Adding attachments alone does not Move the Story or start a Worker.
- [ ] Store bytes and attachment metadata under `.sf/boards/<board-id>/attachments/<Story-Key>/` in the Supervisor's Project, outside runtime and outside the Story worktree's copy of `.sf`. Use server-generated opaque attachment ids and store the original filename as metadata, with at least id, name, media type, and byte size returned by listing. Same-named files coexist without overwriting. Attachments survive restart, later Story edits, Moves, and Story Worktree cleanup. Existing Stories without attachments continue working without migration or a schema field.
- [ ] Reopening an existing Story lists persisted files with filename and size, and offers a download that returns the original bytes. Browser downloads use the existing token authentication (fetch plus a downloaded blob is acceptable); no public/static attachment directory or token in download URLs. Keep active content such as HTML/SVG as downloads rather than rendering it in the app's origin. Pending selections and errors are distinguishable from persisted files.
- [ ] Provide `sf story attachment add <KEY> <path>`, `sf story attachment list <KEY>`, and `sf story attachment get <KEY> <attachment-id> --output <path>`. Add uploads one local regular file; get writes exact bytes to the explicit output path and refuses to overwrite an existing file. Listing prints ids, filenames, types, and sizes, with an empty result for Stories without attachments. Add/list/get support `--project`, `--worker`, and `--json` consistently with existing commands; JSON output contains metadata/result paths rather than binary contents. Missing Story, attachment, input file, or output parent and invalid destinations yield clear nonzero errors. CLI help and README document examples and the limit below.
- [ ] All attachment commands work through HTTP when sf is running and through the same service when offline. Worker commands validate and refresh the Worker's live Claim using the existing conventions, reject an ended Claim with `claim_gone`, and never release or Move the Story implicitly. User edits to claimed Stories remain permitted, consistent with current `updateStory`. Include attachment list/add/get commands with the correct `--project` and `--worker` tail in generated Worker Briefs so agents can discover them.
- [ ] Enforce a 20 MiB per-file limit in both HTTP and offline service paths and validate it before committing changes. Treat names as display metadata, never filesystem paths; reject malformed ids and prevent traversal or symlink escapes when reading/writing attachment storage. Unknown media types use `application/octet-stream`. HTTP uploads/list/downloads require the existing API token. Handle request size limits without silently truncating data; the current global 1 MB JSON parser is not sufficient for file uploads. Choose a bounded transport and document its request/batch limit consistently in UI/API documentation.
- [ ] Add focused service/HTTP/CLI coverage for byte-exact upload/list/download round trips online and offline, persistence after restart, duplicate filenames, missing records, oversized input, invalid paths/ids, authentication, expired Worker Claims, and attachments being available before creation/HIL-clear triggers. Verify in the running UI: create with multiple dropped/selected files, paste an image in create and edit dialogs, normal text paste, cancel, failure/retry, reopen/download, and no handler when the editor is closed. Run the repository's normal check/test/build commands and capture UI evidence during validation.

### Touch Points

- `src/web/components/StoryEditor.tsx`, attachment UI components as needed, `src/web/api/client.ts`, and `package.json`/lockfile for react-dropzone.
- `src/model/api.ts` and appropriate shared attachment types; `src/server/project/paths.ts`, attachment persistence helpers, and `src/server/project/service.ts` for shared operations and trigger ordering.
- `src/server/routes/stories.ts`, `src/server/server.ts`, and `src/server/services/ClientService.ts` for bounded authenticated file transfer; maintain the token checks in `src/server/routes/index.ts`.
- `src/cli/story.ts`, `src/server/project/brief.ts`, README, and the data-storage section of `docs/specs/01-core-function.md`.
- `test/story.test.ts`, `test/http.test.ts`, `test/cli.test.ts`, `test/offline.test.ts`, and `test/brief.test.ts`, or focused new attachment tests using the same fixtures.

### Assumptions

- “Inside the window” means anywhere in the currently open create/edit Story dialog; with no target Story editor open there is no attachment destination. Handle paste events rather than requiring browser clipboard-read permission; this also supports the platform's normal Cmd+V shortcut.
- Attachments are a built-in Story resource, not custom fields or Markdown body content. Keep their metadata separate from schema fields; the precise manifest format and transport are implementation choices within the guarantees above.
- Selection/drop accepts any regular file, while automatic clipboard attachment is limited to images. No content deduplication is required; deliberately adding the same file again creates another attachment.
- The conservative initial file limit is 20 MiB. Persisted files follow the existing git-tracked `.sf` content policy; this Story does not add Git LFS or garbage collection.
- Save/Create owns submission of the entire pending selection. The service must finish attachment persistence before existing creation/HIL wake logic can spawn work; creating first and uploading later would race with the Worker.
- The feature is one reviewable vertical slice because UI and CLI must share attachment identity, persistence, and validation. No split is needed.

### Follow-ups

None.
