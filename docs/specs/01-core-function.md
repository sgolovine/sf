# Core Functionality

Now that we have the basics of the app in place, this document describes the core function that the app will perform. Terms are defined in [CONTEXT.md](../CONTEXT.md).

## High Level

`sf` is a software factory manager. Users create Stories and add them to a kanban Board in the app. Each Stage (column) can have a Stage Prompt that the user edits. When a Story Moves to a Stage with an enabled Stage Prompt, the Supervisor spawns a Worker with the Story and that prompt.

## Data Storage

- Data is stored in a `.sf` directory in the folder where `sf` runs. The `.sf` directory is committed with the repository, except `.sf/runtime/`, which is gitignored.
- The directory looks like this:

```sh
sf.config.json        # Project configuration.
runtime/              # gitignored: Claims, Worker thread ids, spawn failures, queued spawns.
boards/
  development/
    board.config.json # Board key, Stage list, Story schema, and overrides of sf.config.json for this Board.
    stages/
      ready_for_dev.md  # Stage Prompt text, one file per Stage id.
      in_development.md
      ...
    stories/
      DEV-1.md        # One file per Story, named by Story Key.
      DEV-2.md
```

- Disk is the source of truth. The server watches `.sf` and the UI shows hand edits live. But editing a Story's `stage` by hand is not a Move and does not trigger a Worker.
- All writes to Stories go through sf commands (UI, Supervisor, or Worker), against the `.sf` directory in the Supervisor's checkout. Workers never edit `.sf` files in their worktree. See [ADR 0001](../docs/adr/0001-story-writes-through-sf.md).
- If a Worker runs an sf command while the server is not running, the command writes to disk directly and queues any trigger in `.sf/runtime/`. The Supervisor runs queued triggers when it next starts.

### Configuration

`sf.config.json` holds:

| Setting | Overridable per Board | Overridable per Stage |
| --- | --- | --- |
| Worker agent and model default | yes | yes |
| Worktree base branch (default `main`/`master`) | yes | no |
| Claim timeout (default 2h) | yes | no |
| Extra preamble text for Worker Briefs | yes | no |
| Max concurrent Workers (Project-wide total) | **no** | no |

### Board config

`board.config.json` holds:

- The Board key used in Story Keys (for example `DEV`).
- `storyNumber`, the highest allocated Story number. Allocation and deletion preserve this committed high-water mark, accounting for existing files on older Boards, so deleted Keys are never reused.
- The ordered Stage list. Each Stage has a stable slug id, a display name, a prompt enabled/disabled flag, and optional agent/model overrides. The Stage Prompt text is in `stages/<stage-id>.md`. Renaming a Stage changes only its display name.
- The Story schema: custom fields with types `text`, `number`, `single-select`, `multi-select`, `boolean`, or `date`.
- Overrides of `sf.config.json` settings (see the table above).

### Story file

A Markdown file named `<Story Key>.md`. YAML frontmatter holds `stage` (a Stage id) and the custom field values. The body is the Story description. Story numbers increment per Board.

## SF Concepts

### Supervisor

The agent thread where the `sf-factory` skill was started. It starts the web UI and spawns Workers when Stories Move. (The current code and README call this the "host thread"; that term is retired.)

### Workers

Agent threads spawned by the Supervisor. A Worker runs as a new top-level thread when the harness can spawn threads, otherwise as a subagent.

- **Worker Brief.** A Worker receives an sf preamble (Story Key, Board, Stage list, the Project path, and the sf commands to Move, update, create, and release Stories), then the Stage Prompt, then the Story.
- **Story Worktree.** Every Worker runs in its Story's worktree. The first Worker on a Story creates the worktree and branch from the configured base branch and records the branch on the Story. Later Workers on the same Story reuse it.
- **Claim.** While a Worker is active, it claims its Story and no one else can Move it. The claim ends when:
  - the Worker Moves the Story (this Move is allowed and triggers the next Stage as usual),
  - the Worker runs `release` because it finished without Moving,
  - the user force-releases the Story in the UI, or
  - the Worker runs no sf command for the claim timeout.
- When a claim ends without the Worker's knowledge, sf does not interrupt the thread. Any later sf command from that Worker is rejected with "claim is gone".

### Project

The data root for sf: the `.sf` directory.

### Board

Work in sf is split into Boards.

- Boards live within a Project.
- Boards contain Stories.
- A Board has Stages by which Stories are categorized.
- A Board contains the Story schema (custom fields).

### Stages

Stages are part of a Board and show where a Story is on it. Every Board is created with:

- **Backlog**: always first. It cannot be removed, renamed, reordered, or given a Stage Prompt.
- **TODO**, **In Progress**, **In Review**: initial defaults that the user can rename, reorder, or remove.
- **Done**: always last. It cannot be removed, renamed, reordered, or given a Stage Prompt.

Any other Stage can have a Stage Prompt, with an enabled/disabled flag. If a Story enters a Stage whose prompt is disabled or absent, nothing happens. The Story waits for a manual Move.

### Story

A Story describes a unit of work. The user, the Supervisor, and Workers can create Stories in any Stage. Creating a Story in a Stage counts as a Move into it.

### Deletion

An existing Story can be permanently deleted through its modal's trash icon and confirmation,
`DELETE /api/stories/:key`, or `sf story delete <KEY>`. The CLI command needs no interactive
confirmation and supports `--project`, `--json`, and `--worker`. A live Claim blocks deletion,
even by its own Worker; release it first. Deletion removes the Story file and queued/pending
spawn and cleanup triggers, failure, and worktree warning under the shared mutation lock.
Historical Worker records, Story Worktrees, and branches remain. No Done cleanup runs.
The UI closes only after success and preserves unsaved edits on cancellation or failure.

### Moves

A Move changes a Story's Stage to any other Stage. Stages do not need to be adjacent. The user, Workers, and the Supervisor can all Move Stories, through the UI or sf commands.

When a Story Moves into a Stage with an enabled Stage Prompt:

1. If the Story is claimed by a Worker, the Move is rejected (unless that Worker is making it).
2. If the Project is at max concurrent Workers, the spawn is queued, oldest first, and the Story shows "waiting for a Worker". The Story is not claimed while it is queued. A new Move replaces its queued spawn.
3. Otherwise, the Supervisor spawns a Worker with the Worker Brief, and the Worker claims the Story.
4. If the spawn fails, the Story stays in the new Stage, flagged as failed. The UI shows the error and a "retry" action.

When a Story Moves to Done, sf runs `git fetch --prune`, removes the Story Worktree, and then deletes the branch with `git branch -d`, which refuses a branch git does not see as merged; a kept branch is reported in the cleanup result. If the worktree has uncommitted or unpushed changes, sf keeps it (and the branch), and the UI shows a warning with a "remove worktree" action. With no remote, or when the fetch fails, cleanup uses the refs it already has.

### HIL

A Stage other than Backlog and Done can name a HIL flag field (a boolean field in the Board schema) and a HIL comment field (a text field), in its `hil` setting: `{ "flag": "requires_dev_hil", "comment": "dev_hil_comment" }`. A Worker that needs a human sets the flag and comment for its Stage and releases the Story.

- **Hold.** While a Story's HIL flag for the Stage it is in is true, no Worker spawns for it in that Stage, even on a Move into the Stage. The UI marks the Story and shows the HIL comment.
- **Wake.** When an update flips that flag from true to false or unset, and the Story is not claimed and the Stage has an enabled, non-empty Stage Prompt, sf spawns a Worker exactly as for a Move into the Stage (claim, Story Worktree, queueing at max concurrent Workers). With no server running, the spawn is queued as a trigger, like a Move.

## Practical Example

- A user is building a TODO list application.
- The user sets up the factory and creates one Board called "Development" (key `DEV`).
- That Board has these Stages:
  - **Backlog**: no Worker.
  - **Ready for Development**: a Worker reviews the plan, finds any gaps, and updates the Story. If there are no gaps, it Moves the Story to "In Development".
  - **In Development**: a Worker develops the Story with a custom development skill written by the user (the Stage Prompt references the skill). When development is complete, it opens a PR and Moves the Story to "In Review".
  - **In Review**: a Worker dispatches a PR review agent to check the work. If the review finds issues, it Moves the Story to "In Fixup". If not, it merges the PR and Moves the Story to "Done".
  - **In Fixup**: entered only when a PR review finds issues. A Worker fixes them in the same Story Worktree and Moves the Story back to "In Review".
  - **Done**: work comes here only after it is complete. sf removes the Story Worktree.
