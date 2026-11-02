---
title: Make it possible to have markdown HIL comments. By default HIL comments
  should be markdown.
stage: in_progress
branch: sf/DEV-33
requires_refinement_hil: false
---
## Refinement

### Outcome

Users and Workers can write Markdown in HIL comments, and humans see formatted comments on Story cards and in the Story editor. Markdown is the default editing and display experience for configured HIL comments, including existing comments backed by text fields.

### Scope

In: allow Stage HIL comment bindings to use either `markdown` or existing `text` schema fields; Markdown editing and rendering for those configured fields; CLI/API persistence compatibility; relevant documentation and regression coverage.

Out: changing HIL hold/wake, Claims, dependencies or scheduling; introducing a new field type or Markdown engine; automatically creating HIL fields on new Boards; rewriting existing Project schemas or Story values; changing unrelated text fields.

### Acceptance Criteria

- [ ] Board/Stage validation accepts a HIL comment binding to an existing `markdown` or `text` field. Missing fields and other types are rejected with an accurate error. Boolean flag requirements and fixed-Stage restrictions remain intact. Schema edits can convert a bound comment between `text` and `markdown` without losing the binding or comment values.
- [ ] Board Settings → Stages offers both Markdown and text fields in the HIL comment selector, preserving an existing selection. Documentation recommends `markdown` when defining new HIL comment fields. The current no-comment option remains available.
- [ ] In the Story editor, every custom field referenced as a HIL comment by any Stage on the Board uses the existing Write/Preview Markdown editor by default, even when its schema type is legacy `text`. Non-HIL text fields retain their current editor. Fields shared by Stages appear only once and retain the normal Save/Cancel behavior.
- [ ] Active HIL comments render through the existing shared Markdown component in both the Story card and the Story editor's “Needs a human” notice, regardless of whether the bound field is `text` or `markdown`. Plain prose still reads normally; empty comments remain omitted. Lists, emphasis, links, fenced code and GFM task lists render consistently with Story descriptions. Raw HTML and unsafe links receive the same protections as the existing renderer.
- [ ] Rendered comments fit the card/dialog at narrow widths, including long links and code, without breaking their layout; links remain usable and do not trigger unintended Story actions. Do not nest Markdown block output inside a paragraph or span.
- [ ] CLI and API updates preserve multiline Markdown source as a string through save/reload and return it unchanged in Story fields/HIL details. No terminal Markdown rendering or new command flags are required. Existing text-backed Boards load and save without migration, and hold/release/clear/wake behavior is unchanged.
- [ ] Add focused regression coverage for Markdown and legacy text HIL bindings, invalid types, converting a bound field type, multiline value persistence, and the existing HIL hold/wake lifecycle with Markdown comments. Verify the selector, default Write/Preview editing, and both rendered HIL surfaces in the running UI, including plain text, rich Markdown and unsafe HTML/link input.
- [ ] Update the core spec and Worker command reference to describe Markdown as the HIL comment default and `text` compatibility; update relevant model/component documentation that currently says comments must be text fields.

### Touch Points

- `src/server/project/config.ts`: `validateHil` and Board schema validation.
- `src/web/components/BoardSettings/StagesTab.tsx`: `HilFields` selector.
- `src/web/components/StoryEditor.tsx`: custom field rendering and active HIL notice.
- `src/web/components/StoryCard.tsx`: active HIL display.
- `src/web/components/Markdown.tsx`, `MarkdownEditor.tsx`, and `src/web/index.css`: reuse the existing renderer/editor; adjust layout only if needed.
- `src/model/config.ts`: `StageHil` documentation; `activeHil` already returns the raw string and need not change its public shape.
- `test/hil.test.ts`, `test/cli.test.ts`, and existing Story persistence tests as appropriate.
- `docs/specs/01-core-function.md` (HIL) and `skills/sf/references/worker-commands.md`.

### Assumptions

- “By default” means HIL comments use Markdown editing/display without an opt-in switch, including existing text-backed bindings. The declared field type and stored source remain unchanged; there is no migration or extra format metadata.
- sf currently creates Boards with an empty custom-field schema and does not generate HIL comment fields. Keep that behavior; new setup guidance recommends the existing `markdown` type.
- Reuse the Markdown/GFM behavior already used for descriptions rather than introducing another syntax or renderer. CLI/API consumers continue receiving raw source.
- The Story has no prerequisite dependencies or previously delivered changes to reconcile. Its original request is in the unchanged title; the body was empty.

### Follow-ups

None. This is one focused, reviewable change.
