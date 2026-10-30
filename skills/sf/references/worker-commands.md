# Project commands

Every command below accepts `--json` and `--project <dir>` (default: `$SF_PROJECT`, then the current directory). When the sf server is running, the command goes through it and the UI updates live. When it is not, the command writes `.sf/` directly and queues any Worker spawn or worktree cleanup until the next `sf start`.

Exit codes: `0` success, `1` error, `3` rejected: `claim is gone`, or the Story is claimed by another Worker.

## Workers

A Worker runs the exact commands in its brief; they may use an absolute path instead of `sf`. Every Worker command passes `--worker <id> --project <abs path>`, where the path is the Supervisor's checkout, not the worktree. Workers never edit `.sf` files in their worktree.

```sh
sf story show DEV-3 --worker w-1a2b --project /abs/repo
sf story update DEV-3 --title "..." --field priority=high --body-file notes.md --worker w-1a2b --project /abs/repo
sf story create DEV --title "Follow-up" --stage backlog --worker w-1a2b --project /abs/repo
sf story move DEV-3 in_review --worker w-1a2b --project /abs/repo   # ends the Claim
sf story release DEV-3 --worker w-1a2b --project /abs/repo         # ends the Claim without a Move
```

Each Worker command refreshes the Claim. After the Claim ends, every command from that Worker fails with `claim is gone` (exit 3); the Worker should stop.

## Boards and Stages

```sh
sf init
sf board list
sf board create Development --key DEV          # Backlog, TODO, In Progress, In Review, Done
sf board show DEV
sf stage add DEV "In Fixup" --after in_review
sf stage set DEV todo --name "Ready for Development" --prompt-file prompts/ready.md --prompt-enabled true
sf stage set DEV todo --agent codex --model <model-id>   # an empty value clears the override
sf stage set DEV in_progress --hil-flag requires_dev_hil --hil-comment dev_hil_comment   # "" clears
sf stage reorder DEV in_fixup --index 3
sf stage remove DEV in_fixup                      # only when the Stage holds no Stories
```

Stage ids never change on rename. Backlog (first) and Done (last) cannot be renamed, reordered, removed, or given a Stage Prompt or HIL fields.

## Stories

```sh
sf story create DEV --title "Add dark mode" [--stage todo] [--field priority=high]... [--body "..." | --body-file <p>]
sf story list [DEV] [--stage todo]
sf story show DEV-3
sf story move DEV-3 in_progress
sf story update DEV-3 [--title ...] [--field k=v]... [--body ... | --body-file <p>]
sf story force-release DEV-3     # end any Worker's Claim
sf story retry DEV-3             # respawn after a failed spawn
sf worktree ensure DEV-3
sf worktree remove DEV-3 [--force]
```

`--field` values follow the Board's Story schema: numbers, `true`/`false`, `YYYY-MM-DD` dates, one option for single-select, and comma-separated options for multi-select. An empty value (`--field priority=`) clears the field.

Creating a Story in a Stage, or Moving it there, spawns a Worker when the Stage has an enabled, non-empty Stage Prompt. A claimed Story can be updated by anyone, but only its Worker can Move it. Editing `stage:` in a Story file by hand is not a Move and starts no Worker.

When a Story Moves to Done, sf fetches, removes its worktree if it is clean and pushed, and deletes the `sf/<KEY>` branch with `git branch -d`, which keeps a branch git does not see as merged. `sf worktree remove` reports a kept worktree or branch and why.

## HIL (human in the loop)

A Stage can name a HIL flag field (boolean) and a HIL comment field (text) from the Board schema; `sf board show` lists them as `hil=<flag>/<comment>`. While a Story's HIL flag for its current Stage is true, sf starts no Worker for it there, even when it is Moved in. When a Worker needs a human, it records the question and hands the Story back:

```sh
sf story update DEV-3 --field requires_dev_hil=true --field "dev_hil_comment=Which auth provider?" --worker w-1a2b --project /abs/repo
sf story release DEV-3 --worker w-1a2b --project /abs/repo
```

The Story stays in its Stage, marked in the UI with the comment. When a human clears the flag (`sf story update DEV-3 --field requires_dev_hil=false`, or unchecks it in the UI), and the Story is unclaimed and the Stage has an enabled Stage Prompt, a Worker starts as if the Story had just entered the Stage. Clearing the flag of another Stage starts nothing.

## Configuration

`.sf/sf.config.json` holds the Project defaults: `worker.agent`/`worker.model`, `worktree.baseBranch`, `claimTimeoutMinutes` (120), `briefPreamble`, and `maxConcurrentWorkers` (3). Edit it by hand; the next sf command picks it up. A Board can override all but `maxConcurrentWorkers` under `overrides` in its `board.config.json`, and a Stage can override `agent` and `model`.

## Attachments

```sh
sf story attachment add DEV-3 ./screenshot.png --worker <id> --project <root>
sf story attachment list DEV-3 --worker <id> --project <root> --json
sf story attachment get DEV-3 <attachment-id> --output ./download.png --worker <id> --project <root>
```

Add uploads one regular file up to 20 MiB. Get writes exact bytes and refuses to overwrite an existing file. Commands work with the server running or stopped, refresh the Worker Claim, and never Move or release the Story. Files live in the Supervisor's Project and survive Story Worktree cleanup.
