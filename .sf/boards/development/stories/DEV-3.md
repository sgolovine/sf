---
title: New Story / Edit Story - Move extra fields to another tab.
stage: done
branch: sf/DEV-3
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/7
requires_validation_hil: false
requires_review_hil: false
---
When creating or editing a story, move all custom fields to another tab.

Use ShadCN tabs

Title, Stage and Description should stay in the first tab.
All other fields should move to second tab.

Ui only change.

## Refinement

### Outcome

New Story and Edit Story open on a focused Details tab. Users switch to Custom Fields to edit the Board's schema fields without losing their work.

### Scope

In: reorganize the shared StoryEditor dialog using the existing ShadCN Tabs components; preserve the Description Write/Preview tabs and all existing form and save behavior.

Out: API, CLI, persistence, schema, validation, Story Move behavior, Board settings, and unrelated styling changes.

### Acceptance Criteria

- [ ] Both New Story and Edit Story expose two main ShadCN tabs, in order: Details and Custom Fields. Each freshly opened dialog defaults to Details.
- [ ] Details contains Title, Stage information, and Description. Stage retains current behavior: an editable selector defaulting to Backlog for creation, and read-only current Stage for an existing Story. This change does not add a Move action to editing.
- [ ] Custom Fields contains every field from board.config.schema, including HIL flags and comment fields, in schema order. Schema inputs do not appear in Details. Existing labels, input types, options, and clearing semantics are preserved for text, number, boolean, date, single-select, and multi-select fields.
- [ ] Both tabs remain available when the schema is empty; Custom Fields displays a concise empty state such as "No custom fields."
- [ ] Switching main tabs repeatedly preserves unsaved Title, creation Stage, Description, every custom field value, and the selected Description Write/Preview mode. Description retains its current initial mode and preview/double-click behavior.
- [ ] Cancel and Create Story/Save remain outside the main tab panels and available from either tab. Switching either set of tabs does not submit the form. Submitting from either main tab saves the complete form, including fields on the inactive tab, using the existing API payload and title-required behavior.
- [ ] Existing dialog metadata and the active HIL notice remain available independently of the selected main tab. Users can reach the HIL schema inputs on Custom Fields and save them with the same behavior as before.
- [ ] The two tab groups have distinct accessible labels, keyboard navigation works independently for the main and Description tabs, and the dialog remains usable with scrolling at narrow viewport widths.
- [ ] Validate both create and edit flows in the running UI: switch tabs after edits, save from each main tab, reopen to confirm persisted values, check an empty schema and representative schema field types, and capture screenshots of both main tabs. Run the repository's standard static checks and tests.

### Touch Points

- src/web/components/StoryEditor.tsx: shared create/edit dialog, form state, schema rendering, Description tabs, HIL notice, and footer.
- src/web/components/ui/tabs.tsx: reuse its existing Tabs, TabsList, TabsTrigger, and TabsContent exports; no new tab dependency is needed.
- src/web/components/BoardSettings/BoardSettings.tsx: existing tab and Custom Fields naming conventions for reference.
- src/web/App.tsx: existing StoryEditor entry point, for verification rather than an expected behavior change.
- docs/specs/01-core-function.md: Board schema field types and HIL semantics to preserve.

### Assumptions

- Name the first tab Details and the second Custom Fields, matching the existing Custom Fields terminology in Board settings.
- "All other fields" means the Board schema inputs; dialog metadata, the HIL notice, and actions remain shared dialog content.
- Preserve read-only Stage behavior in Edit Story; present current Stage information within Details while retaining useful dialog metadata.
- An empty schema still gets a Custom Fields tab with an empty state, so dialog structure is consistent across Boards.
- This is one bounded UI change and requires no split.

### Follow-ups

None.
