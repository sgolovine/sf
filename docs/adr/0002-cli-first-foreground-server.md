# sf is one CLI, and `sf start` runs the server in the foreground of the Supervisor's thread

sf used to be a pnpm workspace whose skill bundled its own host script, and `sf-factory start` spawned a detached `serve` process that stopped itself after 2 minutes without a Supervisor heartbeat, or after 6 hours idle. Now one root package builds one `sf` binary (`dist/sf.mjs`, which serves `dist/ui`), and the skill is instructions only. `sf start` runs Express in-process and stays in the foreground: the Supervisor runs it as a background process of its own thread, the way a person runs it in a terminal. sf stops on Ctrl-C, SIGTERM or SIGHUP, `sf stop`, or when the process that started it exits. For the last, it records its parent pid and the parent's own parent at startup, and checks every second (every 3 seconds where there is no `/proc` and it runs `ps`) whether the parent has changed or is gone, or the parent's parent has changed. So it stops when its parent is killed with SIGKILL, and also when the agent is killed but the wrapper shell between them (for example Claude Code's `zsh -c …`) is orphaned and keeps running.

A server tied to the thread that uses it needs no heartbeat or idle timer, and no process outlives the agent. `.sf/runtime/server.json` is still how other `sf` commands find the server; `sf start` exits with an error when a live server already owns it.

## Considered Options

- **Keep the detached server with a heartbeat.** Rejected: the server outlived the thread by up to 2 minutes, and stopped under a Supervisor that was busy for longer than that without contacting it.
- **Stop when stdin closes.** Rejected: agent harnesses start background commands with stdin at `/dev/null`, so stdin is closed from the start.
- **Keep the workspace packages.** Rejected: one package and one binary are simpler to build, install (`pnpm link --global` or `npm i -g .`), and run.

## Consequences

- The check sees two levels: the parent and the parent's parent. Two or more wrappers between the agent and sf (for example `pnpm sf start` in a shell the agent started) can still keep sf running after the agent is killed, until a wrapper next to sf exits. The skill therefore runs `sf start` directly, and `scripts/sf-dev.mjs` imports the CLI in-process instead of spawning a child. The second level is skipped when the parent's parent is pid 1 at startup or cannot be read.
- When no agent can run a background process, the user runs `sf start` in a terminal.
- Worker Briefs name `sf` only when the first `sf` on PATH is this build, so another `sf` (for example the Salesforce CLI) is never used; otherwise they use the absolute command.
