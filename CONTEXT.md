# sf

sf is a software factory: Stories move across Stages on a Board, and each move can hand the Story to an agent that does the Stage's work.

## Agents

**Supervisor**:
The agent thread running the `sf` skill. It starts the web interface with `sf start` and spawns Workers when Stories move.
_Avoid_: Host thread, host, orchestrator

**Worker**:
An agent thread spawned by the Supervisor to carry out one Stage Prompt for one Story, always in that Story's Story Worktree. Runs as a new top-level thread when the harness allows it, otherwise as a subagent. A Worker changes Stories only through sf commands.
_Avoid_: Child, job, runner

**Claim**:
The hold an active Worker has on its Story. While a Story is claimed, no one else can Move it. The claim ends when the Worker Moves the Story, releases it, the user force-releases it, or it goes without any sf command from the Worker for the claim timeout. A Claim is command authority only; ending it does not end the Worker's Execution.
_Avoid_: Lock, lease

**Execution**:
One launch of a Worker (a launch generation), recorded durably in the runtime ledger with its machine, identities, Story branch and task/thread IDs. A non-terminal Execution occupies a Worker slot on its machine and fences its Story branch until correlated evidence from the Supervisor confirms it ended or never started. See [the execution ledger](docs/execution-ledger.md).
_Avoid_: Job, run, lease

**Worker Brief**:
What a Worker receives: an sf preamble (Story key, Board, Stages, and the sf commands), the resolved configured `briefPreamble` when present, optional `## SF.md` and `## BOARD.md` sections, then `## Stage Prompt` and `## Story`.
_Avoid_: Handoff, payload

**SF.md and BOARD.md**:
Project owners can maintain optional, case-sensitive Markdown files at `.sf/SF.md` (shared by every Board's Workers) and `.sf/boards/<board-id>/BOARD.md` (shared by that Board's Workers across Stages). The Board id determines the path, not its display name or Story key prefix. These files supplement the existing resolved `briefPreamble`; sf does not expand templates or interpret instruction conflicts.

Worker Briefs contain, in order: the sf operational preamble (including commands and HIL guidance), the resolved `briefPreamble` when present, `## SF.md`, `## BOARD.md`, `## Stage Prompt`, and `## Story`. Each instruction section appears only when its file contains nonblank text, with only surrounding whitespace trimmed. Missing, empty, or whitespace-only files are omitted independently; other read errors report the failing path. Existing Projects need no migration or generated files.

sf reads these files from the service's Project root in the Supervisor's checkout each time it composes a brief, including when concurrency-queued spawns or offline pending triggers are drained. Creation, edits, and deletion take effect on the next composition without a restart. Already composed/dispatched briefs and running Workers are unchanged. The files do not instruct the Supervisor or enable Stages, start Workers, or change Claims and HIL behavior; an enabled, nonblank Stage Prompt is still required.

## Work

**Project**:
The sf data root: the `.sf` directory in the repository where sf runs. Committed with the repository.
_Avoid_: Workspace, factory

**Board**:
A set of Stages and the Stories on them, with its own Story schema (custom fields). A Project holds one or more Boards. New Board opens a dismissible modal over the current screen; an empty Project opens it initially and keeps a New Board action after dismissal.
_Avoid_: Kanban, column set

**Stage**:
A column on a Board that marks where a Story is. Every Board has Backlog (always first) and Done (always last), which cannot be removed, renamed, reordered, or given a Stage Prompt; all other Stages are user-defined.
_Avoid_: Column, status, state

**Stage Prompt**:
The optional, toggleable instructions attached to a Stage. When enabled, a Story entering the Stage gets a Worker running this prompt; when disabled or absent, the Story waits.
_Avoid_: Column prompt, stage instructions

**Story**:
A unit of work on a Board, stored as one Markdown file whose frontmatter records its Stage, optional built-in Worker model, and custom fields. Worker models inherit Story → current Stage → Board → Project → Supervisor default.
_Avoid_: Ticket, card, issue, task

**Story Worktree**:
The git worktree and branch that belong to one Story, created from the configured base branch by its first Worker and reused by every later Worker on that Story. When the Story Moves to Done, sf removes the worktree and deletes the branch once it is merged, unless the worktree has uncommitted or unpushed changes.
_Avoid_: Workspace, sandbox

**HIL**:
Human in the loop: a Story that a Worker left in its Stage because it needs a human, recorded in that Stage's HIL flag and comment. While the flag is set, no Worker runs on the Story in that Stage, even after a Move; when a human clears it, a Worker starts.
_Avoid_: Blocked, escalated, needs human

**Story Key**:
A Story's identifier: the Board's key plus a number, such as `DEV-12`. Also the Story's file name.
_Avoid_: Story id, slug

**Move**:
Changing a Story's Stage to any other Stage through the UI or an sf command, by the user, a Worker, or the Supervisor. Creating a Story in a Stage counts as a Move into it. A Move triggers a Worker, and so does a human clearing a Story's HIL; editing the Stage in the file by hand does not.
_Avoid_: Transition, drag

**Attachment**:
A file belonging to a Story, stored with display metadata under the Supervisor’s Project. Users stage files in the Story editor until Save/Create; Workers upload, list, and retrieve them with `sf story attachment ...`. Attachments persist across Moves and Story Worktree cleanup.

**Dependency wait**:
A Story's built-in `dependsOn` list names prerequisite Story keys in the same Project, across Boards. sf starts no Worker until every key is Done. The current Stage stays unchanged. Workers record a wait and release atomically with `sf story wait`; dependency completion resumes that Stage through the normal capacity queue. HIL is independent and is never automatically cleared. Missing prerequisites remain unresolved; supported deletion rejects referenced Stories.

**Placement policy**:
Optional Project `scheduling` defines local/remote capacities, stable environment/project mappings,
and explicit machine order. Built-in Story `placement` inherits, selects local-only, requires a remote,
or prefers a remote with ordered fallback. DEV-9 persists/validates these and provides a pure selector;
dispatch uses it to reserve capacity per machine (DEV-10). When it selects a configured remote, sf adds
a machine request and machine instructions to the Worker launch request; the Supervisor's harness owns
machine handling (DEV-11). Users edit both through `sf project set`/`sf story --placement` or the UI;
sf rejects edits that orphan a placement or remap an occupied machine (DEV-12). See the core spec for
schema, precedence and eligibility reasons.
