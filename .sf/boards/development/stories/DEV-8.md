---
title: Configure inherited model defaults for Project, Board, Stage, and Story
stage: done
branch: sf/DEV-8
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/12
requires_validation_hil: false
review_rounds: 1
requires_review_hil: false
---
## Goal

Let users configure a default Worker model at Project (global), Board, Stage, and Story levels. Resolve the effective model using the closest explicit selection: Story → current Stage → Board → Project.

## Requirements

- Provide a model selector at each of the four levels. A missing or cleared override inherits from the next broader level.
- Include these predefined models: GPT 6.1 Sol, Opus 5.5, Fable 5.1, Haiku 5.5, GPT 6 Luna, GPT 6.1 Terra, and GPT 6 Astra.
- Allow users to add custom model slugs and select them alongside the predefined models. Keep display labels distinct from the model slugs sent to Workers; confirm canonical preset slugs during refinement rather than deriving them from labels.
- Store model options and default selections in `sf.config.json` at Project level and `board.config.json` at Board level. Stage and Story model overrides belong in their respective Markdown frontmatter.
- Make the Story model a built-in, standard field available on every Story. It must not be managed, removed, or redefined through the custom-field schema/editor.
- Show whether the selection is inherited and the effective model/source, so users can understand which level supplies the model.
- Apply the resolved model to Worker spawning and briefs. Moving a Story to another Stage must use the new Stage's model unless the Story has an explicit override.
- Support reading/writing these selections through the relevant CLI commands as well as the UI, preserving unrelated configuration and frontmatter.

## Acceptance criteria

1. With all four levels configured, the Story model is used. Clearing successive overrides falls back to Stage, then Board, then Project.
2. A Story without an override uses its current Stage's override; moving it changes the effective model when the destination Stage has a different override.
3. Each listed preset can be selected, saved, reloaded, and used for Worker spawning with its corresponding slug.
4. A custom slug can be added, persisted, selected, reloaded, and passed unchanged to a Worker. Project and Board model options/defaults persist in their JSON configuration files.
5. Stage and Story overrides round-trip in frontmatter, and clearing an override restores inheritance without changing the broader defaults.
6. Every Story exposes the built-in model selector, independently of the Board's custom fields; custom-field configuration cannot redefine or remove it.
7. Existing projects, Boards, Stages, and Stories without the new settings continue loading. Define and document the final fallback when none of the four levels selects a model, preserving existing runtime behavior where possible.
8. Automated coverage verifies precedence, clearing overrides, Stage moves, preset/custom slug persistence, Worker model propagation, and compatibility with existing configuration.

## Refinement decisions

Confirm canonical preset slugs, how Board model options extend or override Project options, and how legacy Stage model storage migrates to frontmatter. Preserve valid existing selections during migration.

## Refinement

### Outcome

Users choose a Worker model at Project, Board, Stage, or Story level and can see the effective slug and the level supplying it. The next Worker uses Story → current Stage → Board → Project precedence. Clearing a selection restores inheritance.

### Scope

In: one coherent vertical change covering model catalogs, configuration/frontmatter compatibility, shared resolution with source metadata, CLI/API writes and reads, four UI selectors, Worker commands/briefs, documentation, and regression tests. Keep this together so the selectors cannot ship without their persistence and spawning behavior.

Out: changing agent inheritance, adding provider credentials or provider discovery to sf, model inference settings (effort, temperature, service tier), editing catalogs per Stage/Story, changing active Workers when settings change, or changing Claim/HIL/queue/worktree rules.

### Acceptance Criteria

- [ ] Use these exact label → slug pairs, verified against the T3 live model catalog during refinement on 2026-10-29: GPT 6.1 Sol → `gpt-6.1-sol`; Opus 5.5 → `claude-opus-5-5`; Fable 5.1 → `claude-fable-5-1`; Haiku 5.5 → `claude-haiku-5-5`; GPT 6 Luna → `gpt-6-luna`; GPT 6.1 Terra → `gpt-6.1-terra`; GPT 6 Astra → `gpt-6-astra`. Keep labels separate from slugs in a shared preset definition. Do not derive or rewrite slugs from labels.
- [ ] Retain existing Project `worker.model` and Board `overrides.worker.model` defaults. Add Project and Board top-level `modelOptions` arrays of `{slug, label}` for custom catalog entries; absent arrays mean empty. “Model options” here means available model choices, not inference parameters. Presets are always available. Effective Board choices are presets plus Project customs plus Board customs; deduplicate by exact slug, with a Board custom label overriding a Project custom label. Custom entries cannot relabel built-in presets. Adding an option does not select it automatically.
- [ ] Custom slugs must be nonempty strings without leading/trailing whitespace; reject blank/malformed entries rather than silently changing them. A custom label is optional in the UI/CLI and defaults to the slug when persisted. A saved selection that is absent from the catalog remains valid and appears as an additional choice using its slug as label. Catalog edits never clear existing selections, including legacy Stage values.
- [ ] Store Stage `model` in YAML frontmatter of `.sf/boards/<board>/stages/<stage-id>.md`, leaving the prompt in the Markdown body. Store Story `model` as a built-in top-level frontmatter property, separately from custom `fields`, alongside title/stage/branch. Expose it as a standard property through API/snapshots and Story create/update operations. Missing/null/empty selections inherit; canonical writes remove cleared Stage/Story keys and use null or omission for cleared JSON defaults.
- [ ] Resolve model and source together in one shared resolver. Tests configure four different slugs and clear each override in turn to prove Story, Stage, Board, Project precedence. With no selection, resolve null and source `supervisor`, omit `model` from `worker.spawn`, and display “Supervisor default” without asserting a particular model. Preserve the existing agent resolver and its precedence.
- [ ] Read old Stage Markdown files containing only prompt text and old Board JSON containing `stages[].model`. An explicit Stage frontmatter `model` key wins over JSON, including null/empty as an explicit inheritance value; absent keys fall back to legacy JSON until migration. Reads alone do not rewrite files. On the next Stage update, migrate its effective model to frontmatter and remove that Stage's legacy JSON model, preserving the prompt body and unrelated frontmatter/configuration. Clearing must remove the legacy value too, so it cannot reappear after reload. Editing a prompt must never discard frontmatter, and prompt rendering/spawning must exclude YAML metadata. A Stage without an existing Markdown file can acquire one containing metadata only.
- [ ] Add CLI `sf project show|set` for the Project model/catalog and `sf board set <board>` for Board model/catalog. Set accepts `--model <slug>` (empty string clears) and repeatable `--model-option <slug>` to add a custom entry with slug as its label, without replacing other options. Existing `sf board show`, new `sf project show`, Stage set output, and Story show expose relevant selections, effective model/source, and catalogs in JSON; human-readable output names the effective model/source. Add `--model <slug>` to Story create/update, retain Stage set `--model`, and document each command. All continue supporting `--project` and `--json`; mutation behavior must match with and without a running server. Add corresponding typed Project/Board API operations and preserve unrelated nested configuration on patches.
- [ ] Reserve `model` in custom-field validation/editor and render its selector even when the Board schema is empty. Story saves include the built-in property independently of schema fields. For a legacy custom-field definition named `model`, keep its data on disk during reads and surface a clear conflict requiring rename before schema changes; do not silently overwrite incompatible custom data or reinterpret a non-string value as a Worker model. Tests cover reserved-id rejection and reading such a legacy Board without data loss.
- [ ] Provide accessible selectors in Project settings (add an entry point from the existing app), Board settings (a Worker/model settings tab), Stage settings, and Story create/edit. Stage selection must be accessible for every Stage, including Backlog/Done without enabling prompts. All selectors show label and slug, an explicit inheritance/default choice, and current effective model/source. Project/Board settings allow adding custom slugs to their respective catalog. Story create previews the chosen Stage; existing Story edits use the Story's actual current Stage. Save/reload and external file refresh show persisted values.
- [ ] Resolve from current persisted settings when spawning, including immediate Move/create, retry, HIL wake, queued spawns, and offline triggers replayed online. Moving an inheriting Story between Stages changes the next Worker's model; a Story override survives a Move. Merely changing a model does not spawn a Worker or restart an active one. Pass exactly the resolved slug in `worker.spawn.model` and include the resolved model/source in the Worker Brief. Update Supervisor instructions to honor supported explicit model requests, preserve slugs, and report unsupported selection/spawn failures visibly rather than claiming a different model was used. Keep existing agent selection unchanged.
- [ ] Automated tests cover all seven presets and an arbitrary custom slug through save/reload and command propagation, precedence/clearing, Stage Move behavior, queued/offline resolution, frontmatter migration including conflicts/clear, built-in field protection, unknown-key preservation, and compatibility with configs lacking every new setting. Exercise CLI/API online and offline writes and inspect the four selectors manually; document the formats, merge rules, migration, and Supervisor fallback in the core spec/README and sf skill references.

### Touch Points

- `src/model/config.ts`, `api.ts`, `project.ts`, `commands.ts`: catalog/selection types, resolved model/source, built-in Story property, typed operations.
- `src/server/project/config.ts`, `story.ts`, `service.ts`, `brief.ts`: resolution, lossless configuration patches, Stage frontmatter reader/writer, legacy compatibility, spawn propagation.
- `src/server/routes/project.ts`, `boards.ts`, `stories.ts`; `src/cli/story.ts`: Project/Board settings operations and standard Story model arguments with online/offline parity.
- `src/web/App.tsx`, `components/AppSidebar.tsx`, `BoardSettings/*`, `StoryEditor.tsx`, `api/client.ts`: Project settings entry, Board model settings, shared selector/custom entry UI, inheritance feedback.
- `test/config.test.ts`, `story.test.ts`, `move.test.ts`, `brief.test.ts`, `offline.test.ts`, `hil.test.ts`, `cli.test.ts`, `http.test.ts` and relevant new tests; `docs/specs/01-core-function.md`, README, `skills/sf/references/{commands,worker-commands}.md`.

### Assumptions

- Keep configuration version 1 with additive optional properties; existing null model defaults retain their runtime meaning.
- Board custom choices extend Project choices; they do not hide them. Presets are a shipped constant, while JSON stores custom entries and explicit defaults. Unknown selected slugs remain usable to preserve existing configuration.
- Model choice does not modify the independent agent setting. The Supervisor maps a model to a supported spawning capability; sf itself does not hard-code a T3 provider instance. An explicit incompatible request should be reported, not silently substituted.
- Preserve unrelated values semantically, including unknown JSON keys, nested settings, and YAML metadata; byte-for-byte formatting preservation is not required.
- Migration is lazy per Stage mutation, with frontmatter authoritative when explicitly present. Other Stage settings stay in Board JSON; only model moves in this Story.
- UI placement and CLI names above are refinement choices fitting the existing settings and subcommand conventions. Custom catalog deletion/renaming is optional; adding and selecting are required.

### Follow-ups

None. The end-to-end inheritance feature remains one reviewable Story; provider integrations and inference settings are outside its scope.


## Development handoff

Implemented on `sf/DEV-8`: `a7c7134` (model feature/tests), `58c5486` (formats and Supervisor docs), `14fbe97` (integrate current origin/main attachments/deletion; preserve both flows).

Checks: `pnpm check` passed; `pnpm test` passed all 95 tests; `pnpm exec vite build` passed. Tests cover all seven presets/custom slugs, four-level precedence/clearing, Moves, queue/offline/retry/HIL resolution, Stage migration/metadata, legacy custom-field protection, unknown-key preservation, and CLI/API online/offline settings.

Manual browser QA used a temporary Project at `/tmp/sf-dev8-ui`, leaving the Story Worktree's `.sf` untouched. Project and Board defaults saved, a Project custom slug was added and selected on a Story, Backlog Stage model saved without enabling prompts, Story clear restored Stage inheritance after reload, and a CLI Stage update refreshed the open Story editor. Built UI was used because the existing Vite `/api` proxy also intercepts source modules under `src/web/api`. T3 preview snapshots timed out twice; Playwright browser fallback completed inspection. Screenshots remain in `/tmp/dev8-browser/{project,stage,story}.png`; formal screenshot evidence/PR belongs to validation.

The remote default branch is `origin/main` (there is no `origin/master`), so the final integration used `origin/main`. No PR existed or was created during development.
