---
title: Add SF.md and BOARD.md concepts.
stage: done
branch: sf/DEV-5
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/9
requires_validation_hil: false
review_rounds: 0
validation_rounds: 0
requires_review_hil: false
---
Currently we have a concept of Stage Prompts.

Add to this concept by introducing `SF.md` and `BOARD.md`

### SF.md

This lives in the `.sf` root for any project and applies to all board and stories. Global instructions relevant to all boards and stages

### BOARD.md

Similar to `SF.md` but only applies to the current board. Applies to all stage prompts and considered global to the board.

## Refinement

### Outcome

Project owners can maintain shared Worker instructions in `.sf/SF.md` and board-specific Worker instructions in `.sf/boards/<board-id>/BOARD.md`. Every Worker Brief includes the applicable files alongside its existing Stage Prompt and Story, so shared guidance need not be repeated in every Stage Prompt.

### Scope

In: optional Markdown files at the two exact, case-sensitive paths; reading their contents from the Supervisor's Project checkout when composing a Worker Brief; deterministic brief composition; compatibility with existing projects and `briefPreamble`; focused tests and documentation.

Out: UI editors, new CLI commands or API endpoints for editing these files, configuration/schema migrations, automatic creation of templates, applying the files to the Supervisor's own conversation, and changes to Worker scheduling or Stage Prompt enablement.

### Acceptance Criteria

- [ ] `.sf/SF.md` supplies shared instructions for every Board's Workers. `.sf/boards/<board-id>/BOARD.md` supplies instructions only for Workers on that Board, across all Stages that run Workers. Board ids, rather than display names or Story key prefixes, determine the path.
- [ ] The generated brief has this order: existing sf preamble (including commands and HIL guidance), existing resolved `briefPreamble` when present, `## SF.md` with project instructions when nonblank, `## BOARD.md` with current-board instructions when nonblank, `## Stage Prompt`, then `## Story`. Both instruction files are included when present; the board file does not replace the project file or the existing preamble. Markdown content is included as text, with only surrounding whitespace trimmed, without template expansion.
- [ ] Each instruction file is independently optional. Missing, empty, or whitespace-only files produce no heading or content. Projects with neither file retain their existing brief output and require no migration or newly generated files. Read errors other than a missing file are surfaced with the failing path rather than silently omitting instructions.
- [ ] Files are read from the service's Project root (the Supervisor's checkout), not the Worker's Story Worktree or process working directory. Changes, creation, and deletion are reflected the next time a brief is composed without restarting sf, including spawns drained from the concurrency queue and offline pending triggers. Already composed/dispatched briefs and running Workers are not rewritten.
- [ ] These files alone do not enable a Stage or start a Worker: disabled/absent/blank Stage Prompts, Backlog/Done, Claims, and HIL behavior retain their existing semantics.
- [ ] Automated coverage verifies section order and preserved content, both files independently absent/blank, compatibility with `briefPreamble`, cross-board isolation, Project-root sourcing, and edits/deletion observed on subsequent brief composition. Service-level coverage verifies the instructions reach emitted Worker Briefs for normal spawns and deferred spawns (concurrency queue and offline pending triggers).
- [ ] `CONTEXT.md`, `README.md`, and `docs/specs/01-core-function.md` document the concepts, exact paths, optional-file behavior, composition order, and edit timing. Update the sf skill reference material that describes Worker Brief contents so it reflects these sections. `pnpm typecheck` and `pnpm test` pass.

### Touch Points

- `src/server/project/paths.ts`: paths for project and board instruction files.
- `src/server/project/service.ts`: `spawnNow` and the read path that supplies instruction text to brief composition; queued and offline spawns already converge here.
- `src/server/project/brief.ts`: `BriefInput` and `composeBrief` section assembly, retaining current command/HIL behavior.
- `test/brief.test.ts` and service test fixtures/suites such as `test/move.test.ts` and `test/offline.test.ts`: brief composition, board isolation, current on-disk content, and deferred-spawn coverage.
- `CONTEXT.md`, `README.md`, `docs/specs/01-core-function.md`, and `skills/sf/references/commands.md`: shared instruction concepts, storage layout, and Worker Brief contents; other nearby comments/docs as needed.

### Assumptions

- `BOARD.md` lives next to `board.config.json`, mirroring `SF.md` next to `sf.config.json`. Both are ordinary committed Markdown files maintained by the project owner; file editing is sufficient for this Story.
- Instructions are additive context, ordered from project to board to Stage. sf does not parse conflicts or enforce natural-language instruction precedence; its own operational preamble remains intact.
- Existing project/board `briefPreamble` resolution remains unchanged. These files supplement it rather than replace or migrate it.
- “Applies to all boards and stories” means inclusion in every applicable Worker Brief, including later Workers on an existing Story. It does not create Workers for Stories whose Stage would not otherwise run one.
- Freshness follows the existing `spawnNow` brief-composition boundary, which can precede Supervisor command pickup; no command re-rendering or live updates to active Workers are required.
- The feature is one coherent, reviewable PR without UI or editing-command expansion.

### Follow-ups

None.

## Accepted edge case — owner decision

The owner accepts the remaining Done-cleanup finding on PR #9 (https://github.com/sgolovine/sf/pull/9#discussion_r4419208750) as an acceptable edge case for DEV-5. If a Worker moves a Story to Done and draining another queued Story fails while reading SF.md or BOARD.md, the completed Story's local worktree/branch cleanup can be skipped and require manual cleanup. The PR has already merged before this Done transition; the merge is unaffected.

Fixing or adding recovery coverage for this specific cleanup failure is not required for DEV-5 acceptance and must not block development, validation, review, or merge of this Story. This exception does not waive instruction-read error reporting or the already-fixed queued/offline and next-stage spawn recovery behavior. Continue with the existing implementation and remaining normal checks, documenting this accepted limitation in the PR as needed.
