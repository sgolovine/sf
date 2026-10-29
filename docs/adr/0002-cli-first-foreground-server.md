# sf is one CLI, and `sf start` runs the server in the foreground of the Supervisor's thread

sf used to be a pnpm workspace whose skill bundled its own host script, and `sf-factory start` spawned a detached `serve` process that stopped itself after 2 minutes without a Supervisor heartbeat, or after 6 hours idle. Now one root package builds one `sf` binary (`dist/sf.mjs`, which serves `dist/ui`), and the skill is instructions only. `sf start` runs Express in-process and stays in the foreground: the Supervisor runs it as a background process of its own thread, the way a person runs it in a terminal. sf stops on Ctrl-C, SIGTERM or SIGHUP, `sf stop`, or when the process that started it exits. For the last, it records its parent pid at startup and checks every second whether the parent has changed or is gone, so it also stops when that parent is killed with SIGKILL.

A server tied to the thread that uses it needs no heartbeat or idle timer, and no process outlives the agent. `.sf/runtime/server.json` is still how other `sf` commands find the server; `sf start` exits with an error when a live server already owns it.

## Considered Options

- **Keep the detached server with a heartbeat.** Rejected: the server outlived the thread by up to 2 minutes, and stopped under a Supervisor that was busy for longer than that without contacting it.
- **Stop when stdin closes.** Rejected: agent harnesses start background commands with stdin at `/dev/null`, so stdin is closed from the start.
- **Keep the workspace packages.** Rejected: one package and one binary are simpler to build, install (`pnpm link --global` or `npm i -g .`), and run.

## Consequences

- The parent-death check sees only the direct parent. A wrapper that survives its own parent (for example `pnpm sf start` under a shell that is killed with SIGKILL) keeps sf running until the wrapper exits. The skill therefore runs `sf start` directly, and `scripts/sf-dev.mjs` imports the CLI in-process instead of spawning a child.
- When no agent can run a background process, the user runs `sf start` in a terminal.
- Worker Briefs name `sf` only when the first `sf` on PATH is this build, so another `sf` (for example the Salesforce CLI) is never used; otherwise they use the absolute command.
