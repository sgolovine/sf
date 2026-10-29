# Stories are written only through sf, against the Supervisor's checkout

The `.sf` Project is committed with the repository, but each Worker runs in its own Story Worktree, which has its own copy of `.sf`. If Workers edited Story files in place, Moves would land on feature branches, stay invisible to the UI until merge, and then arrive through git without triggering any Worker. So Workers, the Supervisor, and the UI change Stories only through sf commands, which write to the `.sf` directory in the Supervisor's checkout. If the sf server is not running, the command writes there directly and queues the trigger for the next Supervisor start. Runtime state (Claims, Worker thread ids, spawn failures, queued triggers) lives in a gitignored `.sf/runtime/` so that committed files hold only content.

## Considered Options

- **Workers edit `.sf` files directly.** Rejected: it forces Workers into the root checkout, or splits Story state across branches.
- **Runtime state in Story frontmatter.** Rejected: noisy, machine-specific diffs in git history.
