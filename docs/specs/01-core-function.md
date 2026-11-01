# Core Functionality

Now that we have the basics of the app in place, this document describes the core function that the app will perform. Terms are defined in [CONTEXT.md](../CONTEXT.md).

## High Level

`sf` is a software factory manager. Users create Stories and add them to a kanban Board in the app. Each Stage (column) can have a Stage Prompt that the user edits. When a Story Moves to a Stage with an enabled Stage Prompt, the Supervisor spawns a Worker with the Story and that prompt.

## Data Storage

- Data is stored in a `.sf` directory in the folder where `sf` runs. The `.sf` directory is committed with the repository, except `.sf/runtime/`, which is gitignored.
- The directory looks like this:

```sh
SF.md                 # Optional shared Worker instructions.
sf.config.json        # Project configuration.
runtime/              # gitignored: Claims, the execution ledger, spawn failures, queued spawns.
boards/
  development/
    BOARD.md          # Optional instructions for this Board.
    board.config.json # Board key, Stage list, Story schema, and overrides of sf.config.json for this Board.
    stages/
      ready_for_dev.md  # Stage Prompt text, one file per Stage id.
      in_development.md
      ...
    attachments/
      DEV-1/
        manifest.json # Original names, media types, sizes, ids, and successful submission ids.
        <opaque-id>   # Exact file bytes; names are never paths.
    stories/
      DEV-1.md        # One file per Story, named by Story Key.
      DEV-2.md
```

- Disk is the source of truth. The server watches `.sf` and the UI shows hand edits live. But editing a Story's `stage` by hand is not a Move and does not trigger a Worker.
- All writes to Stories go through sf commands (UI, Supervisor, or Worker), against the `.sf` directory in the Supervisor's checkout. Workers never edit `.sf` files in their worktree. See [ADR 0001](../docs/adr/0001-story-writes-through-sf.md).
- If a Worker runs an sf command while the server is not running, the command writes to disk directly and queues any trigger in `.sf/runtime/`. The Supervisor runs queued triggers when it next starts.

### Story attachments

New/edit Story dialogs use react-dropzone for multiple files, plus window paste events for images while the editor is open. Pending files are removable; Save/Create commits the entire selection before Stage triggers, and Cancel leaves it unpersisted. Saved files remain listed with authenticated downloads. Text paste is unaffected.

Attachments belong to the Supervisor's Project, outside runtime and Story Worktrees, and survive restart, edits, Moves, and worktree cleanup. They are not schema fields. Limits are 20 MiB per file and 40 MiB / 100 files per submission. Story HTTP JSON accepts at most 60 MiB encoded (base64 plus metadata); other JSON routes accept 1 MiB. Failed validation commits neither Story changes nor any files. A UUID submission id makes retrying the same creation/update idempotent.

`sf story attachment add <KEY> <path>`, `list <KEY>`, and `get <KEY> <id> --output <path>` use the same service online/offline and support `--project`, `--worker`, and `--json`. Add takes one regular file; get refuses overwrites. API upload/list/download require the token header; downloads always use attachment disposition and octet-stream so active file content is not rendered in the app's origin. Opaque ids and symlink checks protect storage paths. See README for API payloads and examples.

### Configuration

`sf.config.json` holds:

| Setting | Overridable per Board | Overridable per Stage |
| --- | --- | --- |
| Worker agent and model default | yes | yes |
| Worktree base branch (default `main`/`master`) | yes | no |
| Claim timeout (default 2h) | yes | no |
| Extra preamble text for Worker Briefs | yes | no |
| Max concurrent Workers (legacy Project-wide total, default 3) | **no** | no |
| Optional machine scheduling policy | **no** | no |

### Machine scheduling policy (DEV-9 policy, DEV-10 dispatch)

Optional Project-only `scheduling` is validated and persisted policy data. Dispatch (DEV-10) selects
with it and reserves per-machine capacity in the execution ledger; see
[the execution ledger](../execution-ledger.md). sf does not handle other machines itself: a configured,
enabled remote is eligible whenever the Supervisor can launch Workers, and when one is selected the
`worker.spawn` command carries a `machine` request and the Worker Brief ends with delimited machine
instructions (DEV-11). The Supervisor's harness owns starting the Worker there. A machine request is
not evidence of remote execution. See [the remote Worker boundary](../remote-workers.md)
and [ADR 0003](../adr/0003-remote-worker-boundaries.md).

Complete example `.sf/sf.config.json` (IDs are illustrative catalog values):

```json
{
  "version": 1,
  "worker": { "agent": null, "model": null },
  "worktree": { "baseBranch": "main" },
  "claimTimeoutMinutes": 120,
  "briefPreamble": "",
  "maxConcurrentWorkers": 3,
  "scheduling": {
    "local": { "capacity": 2 },
    "remotes": [
      {
        "id": "build-server",
        "name": "Build server",
        "environmentId": "env-build",
        "project": { "projectId": "project-build", "repository": "github.com/sgolovine/sf" },
        "enabled": true,
        "capacity": 4
      },
      {
        "id": "spare-server",
        "name": "Spare server",
        "environmentId": "env-spare",
        "project": { "projectId": "project-spare", "repository": "github.com/sgolovine/sf" },
        "enabled": true,
        "capacity": 2
      }
    ],
    "order": ["build-server", "spare-server", "local"]
  }
}
```

Every scheduling field shown is required, with no invented defaults or coercion. Capacities are
finite nonnegative safe integers; zero prevents new selections. `remotes` and `order` are arrays
and may be empty. `enabled` is a boolean. Remote IDs match `[a-z][a-z0-9_-]*`, are unique and cannot
be the reserved ID `local`. Display names, environment IDs and project IDs are nonblank strings
without surrounding whitespace. IDs are opaque canonical catalog values, with no UUID-only
restriction; URLs, whitespace and filesystem paths are rejected. No route, credential or transport
fields are accepted. Unknown scheduling fields are rejected rather than silently ignored.

`project.repository` is the exact public project catalog `repositoryIdentity.canonicalKey`, such as
`github.com/sgolovine/sf`: host followed by nonempty repository path segments, without a scheme,
credentials, query, fragment, whitespace, empty/dot segments or leading/trailing slash. Clone URLs
and checkout paths are invalid; sf never guesses or normalizes them. This schema adopts DEV-7's
observed local identity representation as policy data. The future adapter must compare this value
with the **target** project catalog identity and positively establish mapping and other eligibility.
Syntactic validity is never eligibility evidence.

Order entries must be known, unique machine IDs. Local participates only when explicitly listed;
it is never appended automatically. An empty order makes inherited placement wait. Required or
preferred remotes may be configured outside the automatic order. Exact duplicate environment IDs
are rejected even when an alias is disabled, so aliases cannot multiply capacity. Operators must
configure one T3 environment per physical machine. Limits belong to this sf Project across all its
Boards, not to the host: independent environments on one host and independent sf Projects cannot
share a limit. Physical host equivalence, CPU balancing and host-wide quotas are outside this schema.
Scheduling cannot be set in Board overrides or Stage configuration/frontmatter.

The pure `normalizePlacementPolicy` presents local alone at the legacy capacity/default 3 when
scheduling is absent. When scheduling is present, **only** per-machine capacities apply in the policy;
even an explicitly stored legacy `maxConcurrentWorkers` is ignored and preserved for compatibility.
There is no additional overall cap in v1. Dispatch applies the same precedence: every non-terminal
execution across all Boards counts against its machine.

### Editing scheduling (DEV-12)

`PATCH /api/project/settings` (`sf project set`, Settings → Project → Scheduling) accepts
`scheduling` and `maxConcurrentWorkers` beside the model settings. Omitted keys are unchanged. A
supplied `scheduling` replaces the whole value, validated as above; `null` removes it. The write is
atomic, preserves unrelated config, and drains the queue against the new policy, so a raised cap
launches queued work and a lowered cap stops only new reservations. In the same mutation sf
rejects, listing every reference and its resolution:

- removing a remote that any Story's required/preferred placement names, on any Board;
- removing a remote, or changing its `environmentId`, `project.projectId` or `project.repository`,
  while an occupying execution holds it;
- `scheduling: null` while either applies.

Renames, capacity (including 0 or below current usage), `enabled` and order changes are always
allowed. A disabled required target makes its Stories wait with reason `disabled`. These checks clear
no unknown occupancy or branch fence. Hand edits that bypass them still hit the dispatch guards
(`missing-target`, `unmapped`). The response adds `policy` (`normalizePlacementPolicy`) and
`machines`: `{ id, used, capacity, enabled, configured }` per machine from occupying executions,
where `used` may exceed a lowered cap and `capacity` is null for a machine that is no longer
configured. `sf status --json` returns `{ server, commands, claims, occupying, waiting, machines }`.
The UI footer shows per-machine used/max, and Story cards and the editor show an occupying
execution's remote as "Requested: X" with any Supervisor-reported task/thread IDs as plain text.

### Story placement

`placement` is optional built-in frontmatter, separate from custom fields. Its complete forms are
`{ mode: "inherit" }`, `{ mode: "local-only" }`, `{ mode: "required", machineId: "build-server" }`
and `{ mode: "preferred", machineId: "build-server" }`. No extra keys/target combinations are accepted.
Example Story (all frontmatter modes above use the same shape in HTTP JSON):

```yaml
---
title: Build release artifacts
stage: backlog
placement:
  mode: preferred
  machineId: build-server
priority: high
---
Build and verify the published artifacts.
```

Missing placement means inherit. Shared service create/update and HTTP requests accept `placement`;
patch omission preserves it, while `null` or explicit inherit clears the persisted property.
New required/preferred targets must identify a configured remote (disabled is permitted);
`local` uses local-only instead. Without scheduling, only inherit/local-only are valid new values.
Snapshots, Story details, edits and Moves preserve placement through reload. Unknown custom keys
keep their existing behavior. `placement` is reserved in Board schemas and custom-field payloads;
a legacy custom field with this name is a migration conflict: rename its schema ID and Story data
before loading the Board, rather than silently discarding its values. Built-in fields cannot be
supplied through custom fields to overwrite serialized metadata (the existing legacy `model`
migration remains supported). `sf story create|update --placement inherit|local-only|required|preferred
[--machine <remote-id>]` and the Story editor's Placement control set it; `--placement inherit` sends
`null`, and an omitted flag preserves the value. The editor sends placement only when it changed, so a
Story whose target was removed by hand stays editable; it shows that target as unresolved.

Removing a configured remote does not destroy old overrides. Their structure is read separately
from target validation, so unrelated edits and clearing still work. Explicitly resupplying an unknown
target is rejected with a correction; the selector returns `missing-target` for the stale reference.

### Pure placement selection contract

`selectPlacement(policy, placement, eligibility, usage)` takes normalized policy, Story placement,
per-target eligibility evidence for the **resolved Stage agent/model**, and occupied reservation counts.
It performs no filesystem/network/T3/clock operation, input mutation, reservation or launch.
Candidate order is:

- inherit: Project order;
- local-only: local alone;
- required: that remote alone, with no fallback;
- preferred: that remote then Project order with stable deduplication.

For each candidate it checks eligibility before capacity and selects the first eligible target whose
usage is below capacity. Equal/above capacity (including after a cap reduction) waits; existing work
is never terminated or rebalanced. Absent usage is zero; every supplied usage value must be a finite
nonnegative safe integer, including values for targets outside the candidate list.

Eligibility is supplied explicitly as `{ failures: [] }` for verified eligibility or
`{ failures: ["unreachable", ...], detail?: "..." }` for failures. Missing evidence yields
`incompatible` with an explanation that eligibility is unverified, including for local. The selector
never assumes a target is available. Configured disabled targets and absent target IDs are checked
independently of evidence. One failure is emitted per failed candidate in this exact priority:
`missing-target`, `disabled`, `incompatible`, `unreachable`, `unauthorized`, `unmapped`,
`agent-ineligible`, `model-ineligible`, then `capacity`. Multiple failures never let free capacity
make a target eligible. Candidate reasons remain in candidate order.

Results are `{ kind: "selected", machineId: "build-server" }` or
`{ kind: "wait", reasons: [{ machineId: "build-server", code: "capacity" }, ...] }`, with optional
reason `detail`. With no candidates, the only reason is `{ code: "no-candidates" }` (no machine ID).
Malformed Project configuration is rejected as `SfError("invalid", ...)` at shared load/validation,
not disguised as a wait. Tests simulate caller-owned usage to produce four build-server selections,
two spare-server selections, two local selections, then wait regardless of legacy cap 3. This is
policy evidence; production dispatch reserves remotes and requests them from the harness (DEV-11).

### Shared Worker instructions

Project owners can maintain optional, case-sensitive Markdown files at `.sf/SF.md` (shared by every Board's Workers) and `.sf/boards/<board-id>/BOARD.md` (shared by that Board's Workers across Stages). The Board id determines the path, not its display name or Story key prefix. These files supplement the existing resolved `briefPreamble`; sf does not expand templates or interpret instruction conflicts.

Worker Briefs contain, in order: the sf operational preamble (including commands and HIL guidance), the resolved `briefPreamble` when present, `## SF.md`, `## BOARD.md`, `## Stage Prompt`, and `## Story`. Each instruction section appears only when its file contains nonblank text, with only surrounding whitespace trimmed. Missing, empty, or whitespace-only files are omitted independently; other read errors report the failing path. Existing Projects need no migration or generated files. If an instruction read fails while deferred spawns are drained, sf reports the path and retains unfinished work for a later drain after the file is repaired. This includes the next-stage spawn for a Worker Move that freed capacity, queued behind older work before draining. Already dispatched spawns are not replayed.

sf reads these files from the service's Project root in the Supervisor's checkout each time it composes a brief, including when concurrency-queued spawns or offline pending triggers are drained. Creation, edits, and deletion take effect on the next composition without a restart. Already composed/dispatched briefs and running Workers are unchanged. The files do not instruct the Supervisor or enable Stages, start Workers, or change Claims and HIL behavior; an enabled, nonblank Stage Prompt is still required.

### Board config

`board.config.json` holds:

- The Board key used in Story Keys (for example `DEV`).
- `storyNumber`, the highest allocated Story number. Allocation and deletion preserve this committed high-water mark, accounting for existing files on older Boards, so deleted Keys are never reused.
- The ordered Stage list. Each Stage has a stable slug id, a display name, a prompt enabled/disabled flag, and optional agent overrides. The model override is YAML frontmatter in the Stage Markdown file. The Stage Prompt text is in `stages/<stage-id>.md`. Renaming a Stage changes only its display name.
- The Story schema: custom fields with types `text`, `number`, `single-select`, `multi-select`, `boolean`, or `date`.
- Overrides of `sf.config.json` settings (see the table above).

### Story file

A Markdown file named `<Story Key>.md`. YAML frontmatter holds `title`, `stage` (a Stage id), optional `branch`, the built-in optional `model`, `placement`, and `dependsOn`, and the custom field values. The body is the Story description. Story numbers increment per Board.

## SF Concepts

### Supervisor

The agent thread where the `sf-factory` skill was started. It starts the web UI and spawns Workers when Stories Move. (The current code and README call this the "host thread"; that term is retired.)

### Workers

Agent threads spawned by the Supervisor. A Worker runs as a new top-level thread when the harness can spawn threads, otherwise as a subagent.

- **Worker Brief.** A Worker receives an sf preamble (Story Key, Board, Stage list, the Project path, and the sf commands to Move, update, create, and release Stories), the resolved configured preamble, optional SF.md and BOARD.md sections, then the Stage Prompt and Story.
- **Story Worktree.** Every Worker runs in its Story's worktree. The first Worker on a Story creates the worktree and branch from the configured base branch and records the branch on the Story. Later Workers on the same Story reuse it.
- **Claim.** While a Worker is active, it claims its Story and no one else can Move it. The claim ends when:
  - the Worker Moves the Story (this Move is allowed and triggers the next Stage as usual),
  - the Worker runs `release` because it finished without Moving,
  - the user force-releases the Story in the UI, or
  - the Worker runs no sf command for the claim timeout.
- When a claim ends without the Worker's knowledge, sf does not interrupt the thread. Any later sf command from that Worker is rejected with "claim is gone".
- **Execution.** A claim end revokes authority but does not prove the Worker stopped. Its execution keeps its Worker slot and fences the Story branch (the next Stage waits, Done cleanup is deferred) until the Supervisor reports correlated terminal evidence. Timeouts, force-releases and lost launch results become `unknown` and are reconciled through the Supervisor, never relaunched. See [the execution ledger](../execution-ledger.md).

### Project

The data root for sf: the `.sf` directory.

### Board

New Board opens a shared modal dialog over the current Board or settings screen. Name and Key are required; Key is uppercased as typed. Cancel, Close, Escape, and outside click discard the form and restore focus to the opening control. A pending creation prevents duplicate submission and dismissal; failures appear inside the dialog and retain the inputs for retry. Success selects the new Board through the live session refresh.

Projects without Boards initially open this same dismissible dialog. Dismissal leaves an empty state with a New Board action; session refreshes do not reopen it. First Board creation initializes the Project through the existing API and uses the default Stages below. The dialog traps focus, starts on Name, and scrolls within short viewports.

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

New Story and Edit Story open on a **Details** tab with Title, Stage, and Description. Each configured Stage has a New Story button after its cards, including empty Stages, Backlog, and Done. It opens the dialog with that Stage selected; the header New Story button defaults to Backlog. The synthetic Unknown Stage group has no create button. Creation allows changing the selected Stage, with Worker model inheritance following that selection; editing shows the current Stage read-only. Each creation starts a fresh form on Details. A **Custom Fields** tab contains the Board schema fields in order, or “No custom fields.” when the schema is empty. Switching tabs preserves unsaved values and the Description Write/Preview mode. Dialog metadata, any active HIL notice, and Cancel/Save actions are shared across tabs.

The Story dialog has a URL path: `/create` for New Story on the selected Board and `/<KEY>` (for example `/DEV-19`) for an existing Story; closing it returns to `/`. Opening and closing push history entries, so Back and Forward close and reopen it. Loading a Story path opens that Story with its Board selected. An unknown path or key, a Story deleted while open, or `/create` with no Boards shows no dialog and replaces the URL with `/`. Board and Settings views have no URL.

### Story search

When the Project has a Board, the header shows a Search Stories trigger in every view; it or Cmd/Ctrl+K (ignored while a Story dialog or Create a Board is open) opens a finder dialog with an empty, focused query. Typing fuzzy-matches the key and title of every Story on every Board, in any Stage, through `GET /api/search?q=<text>` (token required). The server ranks matches with `fuzzysort` by each Story's best key or title score and returns at most 50 `{ key, title, board: { id, name }, stage: { id, name } }`, best first; an empty or blank `q` returns `[]`. Up/Down move the highlighted row (the first by default), and Enter or a click opens it at `/<KEY>`, switching to its Board; Escape closes the finder without navigating. The finder has no URL. Bodies and custom fields are not searched.

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

When a Story Moves into a Stage with an enabled Stage Prompt (and no HIL or unresolved dependency hold):

1. If the Story is claimed by a Worker, the Move is rejected (unless that Worker is making it).
2. If the Project is at max concurrent Workers, the spawn is queued, oldest first, and the Story shows "waiting for a Worker". The Story is not claimed while it is queued. A new Move replaces its queued spawn.
3. Otherwise, the Supervisor spawns a Worker with the Worker Brief, and the Worker claims the Story.
4. If the spawn fails, the Story stays in the new Stage, flagged as failed. The UI shows the error and a "retry" action.

When a Story Moves to Done, sf runs `git fetch --prune`, removes the Story Worktree, and then deletes the branch with `git branch -d`, which refuses a branch git does not see as merged; a kept branch is reported in the cleanup result. If the worktree has uncommitted or unpushed changes, sf keeps it (and the branch), and the UI shows a warning with a "remove worktree" action. With no remote, or when the fetch fails, cleanup uses the refs it already has.

### HIL

A Stage other than Backlog and Done can name a HIL flag field (a boolean field in the Board schema) and a HIL comment field (a text field), in its `hil` setting: `{ "flag": "requires_dev_hil", "comment": "dev_hil_comment" }`. A Worker that needs a human sets the flag and comment for its Stage and releases the Story.

- **Hold.** While a Story's HIL flag for the Stage it is in is true, no Worker spawns for it in that Stage, even on a Move into the Stage. The UI marks the Story and shows the HIL comment.
- **Wake.** When an update flips that flag from true to false or unset, the dependencies are Done, the Story is not claimed, and the Stage has an enabled, non-empty Stage Prompt, sf spawns a Worker exactly as for a Move into the Stage (claim, Story Worktree, queueing at max concurrent Workers). With no server running, the spawn is queued as a trigger, like a Move.

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

## Worker models

One shared resolver returns both slug and source: Story → current Stage → Board → Project. A missing, null, or empty selection inherits. With no selection, the result is `{model: null, source: "supervisor"}`; the UI says “Supervisor default” and `worker.spawn` omits `model`. Agent inheritance remains Stage → Board → Project.

Project `worker.model` and Board `overrides.worker.model` retain their existing locations. Both JSON files support top-level `modelOptions` arrays of `{slug, label}` custom choices (absent means empty). Presets always exist; customs extend them, deduplicating exact slugs with Board labels over Project labels. Preset labels cannot be changed. Missing custom labels default to the slug on writes. Adding choices never selects them. Unknown saved selections remain valid and visible. Reject empty custom slugs and whitespace; never derive slugs from labels.

| Label | Worker slug |
| --- | --- |
| GPT 6.1 Sol | `gpt-6.1-sol` |
| Opus 5.5 | `claude-opus-5-5` |
| Fable 5.1 | `claude-fable-5-1` |
| Haiku 5.5 | `claude-haiku-5-5` |
| GPT 6 Luna | `gpt-6-luna` |
| GPT 6.1 Terra | `gpt-6.1-terra` |
| GPT 6 Astra | `gpt-6-astra` |

Stage `model` is frontmatter in `stages/<id>.md`; its body is the prompt and metadata is excluded from rendering/briefs. Story `model` is a standard frontmatter property, outside custom fields. Clearing Stage/Story selections removes their keys. Legacy prompt-only files and `stages[].model` in Board JSON still load. An explicitly present frontmatter model wins, even null/empty; otherwise use the legacy JSON. Reads never rewrite. A Stage update migrates that Stage's effective selection and removes its JSON copy, preserving unrelated JSON/YAML values and prompt body. A Stage can have a metadata-only file. No version bump is required.

`model` is reserved in schema validation/editor. Legacy custom-field definitions/data remain readable and preserved; report a conflict requiring the field and its data to be renamed before schema changes or built-in model writes. Non-string legacy metadata is never used as a Worker model.

Project and Board settings share one Settings view. The Board header's Settings button opens it at Board → Stages, and Settings in the application sidebar opens it at Project → Worker, even with no Boards. Its secondary sidebar lists a Project group (Worker, Scheduling) and then a Board group named for the selected Board (Worker, Stages, Custom Fields, Stage Prompts), omitted when there is no Board; narrow widths show the same groups in a compact section selector. Each Worker section contains the model/catalog controls for its scope. Settings keep the selected Board in context, and Back to board sits at the right of the application header whenever a Board exists. In Stages, left-hand handles reorder movable Stages with pointer/touch input or Space/Enter, arrow keys, and Space/Enter to save; Escape cancels. Backlog and Done remain fixed. Reorders save immediately through the existing Stage operation, and failed saves retain the saved order. Stage Prompts settings expose model selectors for every Stage, including Backlog/Done with prompt controls disabled. Story create/edit always exposes the built-in selector even with an empty schema, using the chosen Stage for creates and actual current Stage for edits. Selectors show labels/slugs, inheritance and effective model/source; live refresh displays persisted values.

CLI: `sf project show|set`, `sf board show|set <board>`, `sf stage set`, and Story create/update support `--model <slug>` (`""` clears). Project/Board set support repeatable additive `--model-option <slug>`. Show output and Stage set expose effective model/source/catalogs as JSON; human output identifies the effective model/source. Typed API operations use GET/PATCH `/api/project/settings`, PATCH `/api/boards/:board`, Stage PATCH, and Story POST/PATCH. JSON model patches merge unrelated nested settings. Commands work online/offline.

Spawns read persisted selections for immediate create/Move, retry, HIL wake, queue drain and offline replay. Moving an inheriting Story changes the next model; a Story override survives. Settings edits do not restart active Workers or trigger a new one. The exact resolved slug goes in `worker.spawn.model`; the Worker Brief names model/source. The Supervisor must honor supported explicit requests and report unsupported/spawn failures visibly, never claim a substituted model was used. Provider discovery, credentials, inference parameters and catalog editing below Board level are outside this feature.

### Story dependencies and automatic wake-up

Stories optionally persist `dependsOn: [DEV-7]` in frontmatter. Omission/empty lists retain legacy behavior. Create/update API and CLI accept complete replacement lists (`--depends-on DEV-7,DEV-8`; empty string clears); unrelated edits preserve them. The Story editor provides the same workflow through a searchable multi-select of Project Stories, with selected keys shown as removable pills. Shared service validation applies online/offline: keys must exist in this Project (cross-Board allowed), with no self reference or cycle; errors identify the bad key or cycle. `dependsOn` is reserved and cannot be a custom field. Supported deletion rejects referenced prerequisites and names their dependents. A prerequisite removed or unreadable outside sf remains unresolved; restore it or explicitly remove its reference rather than treating absence as Done.

Worker dispatch requires every dependency Done in addition to the existing enabled/nonblank prompt, Claim, capacity and HIL rules. Dependency holds and HIL are displayed independently, together when both apply. Resolving dependencies never clears HIL; clearing HIL never bypasses dependencies. Story JSON exposes dependency keys, unresolved keys and a dependency-wait boolean; `hil` and `queued` identify human input and Worker capacity independently.

Dependency waits retain their Stage intent in runtime state. Changes reconcile waits under the same Project mutation lock and use the existing spawn queue and FIFO capacity rules. Startup discovers unresolved dependencies and replays persisted wake intent, including offline completion. Repeated/concurrent completions and restarts do not create a second live Claim. Both capacity-queued Workers and dispatched commands recheck eligibility before launch, including under the mutation lock after asynchronous Story Worktree preparation; reopening a prerequisite does not terminate an already active Worker. No new polling loop, external condition watcher, or automatic Stage Move is introduced.

`sf story wait <KEY> --depends-on <KEY,KEY> --worker <id> --project <root>` (POST `/api/stories/:key/wait`) validates and persists dependencies, records wake intent and releases the caller's own Claim atomically. If completion wins the race, the released Story is queued immediately; if wait wins, completion queues it later. Empty lists are rejected by wait (use update to clear). Briefs include dependency keys, the command and instructions to reread current Story/prerequisite delivery before advancing. HIL is reserved for a specific human decision/action, including necessary external access/configuration; it is never inferred from arbitrary dependency comment text.

Repository Stage Prompt templates live in `.agents/stage-prompts/`. Install with the supported Stage CLI after upgrading sf, as documented in [the migration runbook](../dependency-waits.md). That runbook deliberately migrates dependency-only HIL holds and preserves mixed human requests.
