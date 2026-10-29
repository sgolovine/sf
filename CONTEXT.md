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
The hold an active Worker has on its Story. While a Story is claimed, no one else can Move it. The claim ends when the Worker Moves the Story, releases it, the user force-releases it, or it goes without any sf command from the Worker for the claim timeout.
_Avoid_: Lock, lease

**Worker Brief**:
What a Worker receives: an sf preamble (Story key, Board, Stages, and the sf commands), then the Stage Prompt, then the Story.
_Avoid_: Handoff, payload

## Work

**Project**:
The sf data root: the `.sf` directory in the repository where sf runs. Committed with the repository.
_Avoid_: Workspace, factory

**Board**:
A set of Stages and the Stories on them, with its own Story schema (custom fields). A Project holds one or more Boards.
_Avoid_: Kanban, column set

**Stage**:
A column on a Board that marks where a Story is. Every Board has Backlog (always first) and Done (always last), which cannot be removed, renamed, reordered, or given a Stage Prompt; all other Stages are user-defined.
_Avoid_: Column, status, state

**Stage Prompt**:
The optional, toggleable instructions attached to a Stage. When enabled, a Story entering the Stage gets a Worker running this prompt; when disabled or absent, the Story waits.
_Avoid_: Column prompt, stage instructions

**Story**:
A unit of work on a Board, stored as one Markdown file whose frontmatter records its Stage and custom fields.
_Avoid_: Ticket, card, issue, task

**Story Worktree**:
The git worktree and branch that belong to one Story, created from the configured base branch by its first Worker and reused by every later Worker on that Story. When the Story Moves to Done, sf removes the worktree and keeps the branch, unless the worktree has uncommitted or unpushed changes.
_Avoid_: Workspace, sandbox

**Story Key**:
A Story's identifier: the Board's key plus a number, such as `DEV-12`. Also the Story's file name.
_Avoid_: Story id, slug

**Move**:
Changing a Story's Stage to any other Stage through the UI or an sf command, by the user, a Worker, or the Supervisor. Creating a Story in a Stage counts as a Move into it. Only a Move triggers a Worker; editing the Stage in the file by hand does not.
_Avoid_: Transition, drag
