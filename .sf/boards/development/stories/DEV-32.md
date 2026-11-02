---
title: Add textarea custom field type
stage: done
branch: sf/DEV-32
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/35
requires_validation_hil: false
requires_review_hil: false
model: claude-opus-5-5
---
- Currently we only have a regular input that is one line for custom fields.

- Add a datatype called `markdown` that will show the markdown editor

- Data should remain stored in the sample place.

- Create common component for this.

## Refinement

### Outcome
A Board's Story schema can define a custom field of type `markdown`. In the Story editor's **Custom Fields** tab such a field shows the same Write/Preview markdown editor the Description uses (multi-line textarea + rendered preview), instead of a one-line input. The value is stored exactly where other custom field values are: as a string in the Story file's YAML frontmatter under the field id.

### Scope
In:
- New field type `markdown` in the model (`FieldType` / `FIELD_TYPES`), so it appears in Board Settings → Custom Fields type select and is accepted by Board schema validation.
- Server validation (`validateFields`) treats `markdown` like `text` (must be a string); CLI `--field id=value` passes the raw string through (empty clears), as for `text`.
- A shared `MarkdownEditor` web component (Write/Preview tabs, textarea, `Markdown` preview, double-click preview to edit, "Nothing to preview." when empty, opens on Preview when it has content and on Write when empty). The Story Description switches to it, and `FieldInput` uses it for `markdown` fields.
- Docs: field type list in `docs/specs/01-core-function.md` and the `--field` note in `skills/sf/references/worker-commands.md`.
- Tests for validation/parsing of the new type.

Out:
- Allowing a `markdown` field as a Stage's HIL comment field (HIL comment stays `text`-only).
- Showing custom field values on Board cards, searching them, or changing how Worker Briefs / `story show` print fields.
- Converting existing `text` fields or their data.

### Acceptance Criteria
- [ ] `FIELD_TYPES` includes `markdown`; a Board schema with `{ id, name, type: "markdown" }` saves via Board Settings, `PATCH` API, and CLI, and needs no `options`.
- [ ] Saving a Story with a multi-line string in a `markdown` field persists it as that field's value in the Story's frontmatter, and it round-trips unchanged (newlines preserved) through reload, API, and `story show`.
- [ ] Non-string values for a `markdown` field are rejected with `invalid` ("field <id> must be text…" style message, same as `text`); `--field notes=` clears it.
- [ ] In the Story editor Custom Fields tab, a `markdown` field renders a labelled Write/Preview editor (multi-line textarea, rendered markdown preview); other field types are unchanged. Clearing the text saves the field as null/removed, like `text`.
- [ ] The Description editor and `markdown` fields use one shared component (e.g. `src/web/components/MarkdownEditor.tsx`); Description behavior (default tab, double-click to edit, placeholder, "Nothing to preview.") is unchanged and switching between Details/Custom Fields tabs preserves each editor's values and mode.
- [ ] Stage HIL comment picker still offers only `text` fields; config validation still requires a `text` HIL comment field.
- [ ] Spec and worker-commands docs list the `markdown` type.
- [ ] `pnpm` typecheck, lint (biome), and tests pass, with new tests covering `validateFields` and `parseFieldArg` for `markdown`.

### Touch Points
- `src/model/config.ts` (`FieldType`, `FIELD_TYPES`)
- `src/server/project/story.ts` (`validateFields`, `parseFieldArg`)
- `src/web/components/StoryEditor.tsx` (Description editor, `FieldInput`)
- New `src/web/components/MarkdownEditor.tsx` (uses `Markdown.tsx`, `ui/tabs`, `ui/textarea`)
- `src/web/components/BoardSettings/CustomFieldsTab.tsx` (picks up the new type from `FIELD_TYPES`; verify only)
- `docs/specs/01-core-function.md`, `skills/sf/references/worker-commands.md`
- `test/story.test.ts` (and/or `test/config.test.ts`)

### Assumptions
- "Stored in the same place" means the frontmatter custom field value (a YAML string; the `yaml` library emits block scalars for multi-line strings), not the Story body or a separate file.
- The type id is `markdown` (from the Story text); its label in the type select is the id, as for other types.
- The shared editor copies the Description's current UX exactly, including opening on Preview when non-empty; each field gets its own tab state.
- The Write textarea for fields may be shorter than the Description's (e.g. `rows={4}`) — component accepts rows/min-height props.
- Worker Briefs and `story show` keep printing the raw string as today; multi-line values are acceptable there.

### Follow-ups
None.
