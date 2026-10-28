# Core Functionality

Now that we have the basics of the app in place, this document describes the core function that app will perform.

## High Level

`sf` is a software factory manager. Users can create stories an add them to a kanban board within the app. Each column in the kanban contains a prompt that the user edits. Whenever a story is moved to a new column, this gets communicated back to the supervisor agent that then spawns a new thread with the story + the prompt associated with the column.


## Data Storage

- Data is stored in the same folder where `sf` is run an is stored in an `.sf` directory.

- Inside of the directory looks like this:

```sh
sf.config.json # sf configuration file, stores top level config for the project.
boards/
  board-01/
    board.config.json # board configuration file, overrides any values in `sf.config.json` for this board only
    stages/
      todo.md # individual stage prompts.
      in_progress.md
      in_review.md
      ...
    stories/
      board-01.md # individual stores on the board.
      board-02.md

```

## SF Concepts

### Supervisor

The agent thread where the `sf-factory` skill was started. It's the thread that kicked off the web UI and is responsible for kicking off new Workers when stories move between Stages

### Workers 

Other threads that are started by the supervisor. When a user moves a Story to a Stage like "In Progress", the prompt for "In Progress" and the content of the story are passed down from the Supervisor to a new Worker thread. The worker then executes the instructions 

### Project

The data root for sf. 

### Board

Work on sf is split up into boards

- Boards live within Projects
- Boards contain Stories
- A Board has Stages by which Stories are categorized
- A Board contains the schema for a Story (custom fields)

### Stages

Stages are part of boards and represent where a Story is within a Board. Stages can be fully modified by the user but contain the following defaults:

- Backlog (default, cannot be changed)
- TODO
- In Progress
- In Review
- Done (default, cannot be changed)

A stage can optionally contain a prompt. This should be a boolean enabled/disabled flag on each stage as well as the associated prompt markdown file.

When a Story is moved from one Stage to another Stage, the story + the stage prompt assoicated with the stage it moved to gets passed back to the Supervisor and then the supervisor will spawn a new thread and hand the Story + Prompt to the thread.

The Backlog and Done stages are permananet defaults and cannot be changed. Work yet to start is in Backlog and work that's done is in Done.

### Story

Individual stories that describe what needs to be done.



## Practical Example

- A user is building a TODO list application 

- The user sets up the factory and sets up one board called "Development"

- That board contains several stages
  - Backlog - Agent does nothing, no prompt
  - Ready for Development - A agent goes through the plan and highlights any gaps in the plan, then updates the story accordingly. If no gaps are found they move the story onboards to "In Development".
  - In Development - Starts development on the story using a custom development skill written by the user (the skill is referenced in the stage prompt). After development is complete, it opens a PR and moves the story to In Review.
  - In Review - At this stage the agent dispatches a PR review agent to go over the work that was done and address any issues. If the agent finds any issues they send the work to "PR Fixup" and if the agent does not find any issues then they merge the PR and move the story to "Done"
  - In Fixup - Only accessed when a PR review yeilded some issues, work is sent here and is fixed up by another agent.
  - Done - Work is only sent here after it is completed.