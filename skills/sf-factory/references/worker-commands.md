# Project commands

Every command below accepts `--json` and `--project <dir>` (default: `$SF_PROJECT`, then the current directory). When the sf server is running, the command goes through it and the UI updates live. When it is not, the command writes `.sf/` directly and queues any Worker spawn or worktree cleanup until the next `start`.

Exit codes: `0` success, `1` error, `3` rejected: `claim is gone`, or the Story is claimed by another Worker.

## Workers

A Worker's brief lists its exact commands. Every Worker command passes `--worker <id> --project <abs path>`, where the path is the Supervisor's checkout, not the worktree. Workers never edit `.sf` files in their worktree.

```sh
node "$SF" story show DEV-3 --worker w-1a2b --project /abs/repo
node "$SF" story update DEV-3 --title "..." --field priority=high --body-file notes.md --worker w-1a2b --project /abs/repo
node "$SF" story create DEV --title "Follow-up" --stage backlog --worker w-1a2b --project /abs/repo
node "$SF" story move DEV-3 in_review --worker w-1a2b --project /abs/repo   # ends the Claim
node "$SF" story release DEV-3 --worker w-1a2b --project /abs/repo         # ends the Claim without a Move
```

Each Worker command refreshes the Claim. After the Claim ends, every command from that Worker fails with `claim is gone` (exit 3); the Worker should stop.

## Boards and Stages

```sh
node "$SF" init
node "$SF" board list
node "$SF" board create Development --key DEV          # Backlog, TODO, In Progress, In Review, Done
node "$SF" board show DEV
node "$SF" stage add DEV "In Fixup" --after in_review
node "$SF" stage set DEV todo --name "Ready for Development" --prompt-file prompts/ready.md --prompt-enabled true
node "$SF" stage set DEV todo --agent codex --model <model-id>   # an empty value clears the override
node "$SF" stage reorder DEV in_fixup --index 3
node "$SF" stage remove DEV in_fixup                      # only when the Stage holds no Stories
```

Stage ids never change on rename. Backlog (first) and Done (last) cannot be renamed, reordered, removed, or given a Stage Prompt.

## Stories

```sh
node "$SF" story create DEV --title "Add dark mode" [--stage todo] [--field priority=high]... [--body "..." | --body-file <p>]
node "$SF" story list [DEV] [--stage todo]
node "$SF" story show DEV-3
node "$SF" story move DEV-3 in_progress
node "$SF" story update DEV-3 [--title ...] [--field k=v]... [--body ... | --body-file <p>]
node "$SF" story force-release DEV-3     # end any Worker's Claim
node "$SF" story retry DEV-3             # respawn after a failed spawn
node "$SF" worktree ensure DEV-3
node "$SF" worktree remove DEV-3 [--force]
```

`--field` values follow the Board's Story schema: numbers, `true`/`false`, `YYYY-MM-DD` dates, one option for single-select, and comma-separated options for multi-select. An empty value (`--field priority=`) clears the field.

Creating a Story in a Stage, or Moving it there, spawns a Worker when the Stage has an enabled, non-empty Stage Prompt. A claimed Story can be updated by anyone, but only its Worker can Move it. Editing `stage:` in a Story file by hand is not a Move and starts no Worker.

## Configuration

`.sf/sf.config.json` holds the Project defaults: `worker.agent`/`worker.model`, `worktree.baseBranch`, `claimTimeoutMinutes` (120), `briefPreamble`, and `maxConcurrentWorkers` (3). Edit it by hand; the next sf command picks it up. A Board can override all but `maxConcurrentWorkers` under `overrides` in its `board.config.json`, and a Stage can override `agent` and `model`.
