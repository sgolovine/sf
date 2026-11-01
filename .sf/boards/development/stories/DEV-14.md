---
title: Update the "Depends on" field and UI
stage: done
branch: sf/DEV-14
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/17
requires_validation_hil: false
review_rounds: 0
validation_rounds: 0
model: claude-opus-5-5
---
Currently this field is just a comma separated list. Update it so it's a menu that allows you to select multiple items. Once selected, items appear as a pill with an "X" on the right to remove. Also make this list searchable.

## Refinement

### Outcome
In the Story editor dialog (create and edit), the "Depends on" free-text input is replaced by a searchable multi-select picker. A user opens a menu listing the Stories in this Project (across all Boards), types to filter it, and clicks Stories to add them. Each selected dependency shows as a pill (`DEV-7` plus title, truncated) with an "X" button on its right that removes it. Saving sends the same `dependsOn` list of Story keys the current input sends; no server, CLI, or storage changes.

### Scope
In:
- A new web component (e.g. `src/web/components/DependencyPicker.tsx`) used by `StoryEditor.tsx` in place of the `Depends on` `<Input>`.
- Passing every Board's Stories (from the `ProjectSnapshot` already loaded in `App.tsx`) into `StoryEditor` so cross-Board candidates are available.
- Search filtering by Story key and title (case-insensitive substring).
- Pills with an accessible remove button; keyboard use of the menu.
Out:
- Any change to `dependsOn` validation, the API, the CLI `--depends-on` flag, frontmatter, or wake/dispatch behavior.
- Showing dependency pills on `StoryCard` (its "Depends on DEV-7, DEV-8" text stays).
- Changing the custom-field `multi-select` checkbox UI.
- Adding a new dependency such as `cmdk`.

### Acceptance Criteria
- [ ] The editor no longer has a comma-separated text input for dependencies; the "Depends on" label opens/labels a picker control.
- [ ] Opening the picker shows a menu listing Stories from every Board in the Project, each as key + title, with the Board name shown when the Story is on a different Board than the one being edited.
- [ ] The menu has a search box focused on open; typing filters options by key or title, case-insensitively; with no matches it shows "No matching Stories".
- [ ] The Story being edited is not offered as an option (no self dependency). Already-selected Stories are either hidden from the list or shown checked; selecting one toggles it.
- [ ] Each selected key renders as a pill with the key (and title when known) and an "X" button on its right with `aria-label="Remove <KEY>"`; clicking it removes only that key.
- [ ] A saved key that no longer matches any Story in the snapshot (missing/unreadable prerequisite) still shows as a pill (key only, visually marked as missing) and is kept on save unless the user removes it.
- [ ] The picker is keyboard-usable: arrow keys move through options, Enter toggles the highlighted option, Escape closes the menu without closing the dialog, and Backspace in an empty search box removes the last pill (optional but preferred).
- [ ] Saving sends `dependsOn` as the selected keys in selection order; removing every pill and saving clears dependencies (sends `[]`), matching current behavior. Unrelated edits keep existing dependencies.
- [ ] Server-side errors (cycle, missing key) still appear in the editor's existing error message.
- [ ] The picker respects the editor's disabled state (submitting/deleting/retry-only): no adding or removing while disabled.
- [ ] Help text is updated (no mention of commas), e.g. "Stories in this Project. Workers wait until all are Done."
- [ ] `pnpm check` and `pnpm test` pass; validation includes a screenshot of the picker open with search text and selected pills.

### Touch Points
- `src/web/components/StoryEditor.tsx`: replace the `dependsOn` string state with `string[]`, render the picker, update help text; accept candidate Stories as a prop.
- `src/web/App.tsx`: pass all Boards' Stories (e.g. `boards`) to `StoryEditor`.
- New `src/web/components/DependencyPicker.tsx` (and, if useful, `src/web/components/ui/popover.tsx` shadcn wrapper over `radix-ui`'s Popover, plus reuse of `ui/badge.tsx` for pills).
- Docs: `docs/specs/01-core-function.md` "Story dependencies" paragraph says "The Story editor provides the same workflow" — optionally note it is a searchable multi-select.

### Assumptions
- Candidates are all Stories in the Project across Boards, since dependencies may be cross-Board (spec, CONTEXT.md). Done Stories are still listed (depending on a Done Story is valid and immediately resolved); optionally show their Stage name in the option.
- Build it with the existing `radix-ui` package (Popover) plus a plain filtered list instead of adding `cmdk`/shadcn Command, to avoid new dependencies. The project already uses shadcn-style wrappers in `src/web/components/ui/`.
- Cycle prevention stays server-side; the picker does not pre-compute cycles beyond excluding self.
- Options sorted by Board then Story key number; selected pills ordered by selection.
- No web unit-test harness exists (tests are node-only), so UI behavior is verified in validation via the running app and screenshots.

### Follow-ups
None.
