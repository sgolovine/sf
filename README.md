# sf

Build and run a software factory.

sf is a CLI first. One package builds one `sf` command:

- **CLI** (`src/cli`): `sf setup` installs the `sf` skill for Claude Code, Codex, or OpenCode. `sf start` runs the server in the foreground. The other commands (`sf next`, `sf done`, `sf story ...`) let the Supervisor and Workers talk to the server and change the Project.
- **Server** (`src/server`): an Express server that `sf start` runs in-process. It serves the built web interface, the API, and server-sent events, and turns Moves into `worker.spawn` commands for the Supervisor. `src/server/project` is the Story service.
- **Web interface** (`src/web`): a React + TanStack Query kanban (Tailwind CSS v4 and shadcn/ui). A sidebar lists the Boards, with New Board at the bottom. Users create Stories and Move them on the Board; each Board's Board Settings page has tabs for Stages, Custom Fields (the Story schema), and Stage Prompts (with agent and model overrides).
- **Skill** (`skills/sf`): instructions only. It turns an agent thread into the _Supervisor_: it checks capabilities, runs `sf start` as a background process of its own thread, and spawns a Worker whenever a Story Moves into a Stage with an enabled Stage Prompt.

## Layout

```
src/
  cli/       `sf` entry point (main.ts), `sf start` (start.ts), `sf setup`, Project commands
  server/    Express API and UI hosting; project/ is the Story service
  model/     shared types, routes, and command builders (UI ⇄ server ⇄ Supervisor), imported as #model/<file>
  web/       React UI; api/ has the client and hooks, components/ui the shadcn/ui components
test/        node --test suites
skills/
  sf/          SKILL.md and references, installed by `sf setup`
scripts/
  build.mjs    bundles src/cli/main.ts into dist/sf.mjs
  sf-dev.mjs   runs the CLI from source (sf-dev skill)
```

## How the Supervisor, Workers, and the UI talk

```
UI ── Move / create Story ──▶ server ── Story service (.sf) ──▶ worker.spawn queue
                                  ◀── sf next (long-poll) ── Supervisor ── spawns ──▶ Worker
UI ◀── GET /api/events (SSE) ── server ◀── sf done | fail | say ─ Supervisor
                                  ◀── sf story move|update|create|release --worker ── Worker
```

0. The Supervisor runs `sf start` as a background process of its own thread. The server lives as long as that process: it stops on Ctrl-C, SIGTERM, `sf stop`, or when the process that started it exits.
1. A Story enters a Stage with an enabled Stage Prompt. sf claims the Story for a new Worker id and queues a `worker.spawn` command (or queues the spawn, oldest first, when the Project is at `maxConcurrentWorkers`).
2. The Supervisor runs `sf next`. The server creates or reuses the Story Worktree and hands out the command with the Worker Brief.
3. The Supervisor starts the Worker (a thread, or a subagent when it cannot start threads) and reports `sf done <id> --result <thread id>`, or `fail`.
4. The Worker changes Stories only through `sf story ... --worker <id> --project <root>`. Its Claim ends when it Moves or releases the Story, when the user force-releases it, or after the claim timeout.
5. Every state change streams to the UI over server-sent events.

UI helpers (`src/web/api`):

```ts
sfApi.createStory({ board: "DEV", title: "Add dark mode", stage: "todo" });
sfApi.moveStory("DEV-3", "in_review");   // rejected with code "claimed" while a Worker holds it
sfApi.instruct("Pause after the current task");
const { data: session } = useSession(); // live state: Supervisor, commands, Project snapshot
```

## Project (`.sf`)

sf keeps its data in `.sf/` at the repository root, committed with the repository:

```
.sf/
  sf.config.json            Project defaults: Worker agent/model, base branch, claim timeout, brief preamble, maxConcurrentWorkers
  .gitignore                ignores runtime/
  runtime/                  Claims, queued spawns, failures, pending triggers, server.json (gitignored)
  boards/development/
    board.config.json       key, ordered Stages, Story schema, overrides
    stages/<stage-id>.md    Stage Prompt text
    stories/DEV-1.md        YAML frontmatter (title, stage, branch, custom fields) + description
```

Every Story change goes through `sf` (UI, Supervisor, or Worker). With no server running, CLI commands write `.sf/` directly and queue spawns until the next `sf start`. Hand edits show up in the UI live, but changing `stage:` by hand is not a Move and starts no Worker. Story Worktrees live next to the repository in `<repo>-sf-worktrees/<KEY>` on branch `sf/<KEY>`.

```sh
sf board create Development --key DEV
sf stage set DEV todo --prompt-file prompts/plan.md --prompt-enabled true
sf story create DEV --title "Add dark mode" --stage todo   # spawns a Worker
sf story list
sf start --no-open      # runs until Ctrl-C; prints `sf ready: <url>`
```

See [worker-commands.md](skills/sf/references/worker-commands.md) for every Project command.

The server listens on `127.0.0.1` only. Each `/api` call needs the session token in the `authToken` header. The printed UI URL carries the token in its fragment so the browser can add the header without sending the token in the HTTP URL.

## Development

```sh
pnpm install
pnpm dev            # Express on :4317 + Vite on :5173 → http://localhost:5173/#authToken=dev
pnpm typecheck
pnpm test           # node --test with tsx
pnpm sf:dev <cmd>   # the sf CLI from source, e.g. pnpm sf:dev story list
```

`pnpm dev:server` and `pnpm dev:web` run each part on its own. The dev server (`sf start --dev`) uses this repository as its Project and leaves the UI to Vite. While it runs, other `sf` commands for this repository connect to it.

To test the `sf` skill without building or installing, use the project-internal `sf-dev` skill (`.agents/skills/sf-dev`). It follows `skills/sf/SKILL.md` from source with `pnpm sf:dev` in place of `sf`. On `start`, `sf-dev.mjs` rebuilds the UI into `dist/ui`; it runs the CLI from TypeScript in its own process.

## Build and install

```sh
pnpm build
```

This builds the UI into `dist/ui` and bundles the CLI and server into `dist/sf.mjs`, a single executable file with no runtime dependencies. `sf start` serves `dist/ui`.

Put `sf` on your PATH from a clone with either:

```sh
pnpm link --global      # or: npm i -g .
sf --version
```

From the repository, without installing: `pnpm sf <cmd>` (built) or `pnpm sf:dev <cmd>` (source).

```sh
sf setup                                   # interactive
sf setup --agents claude-code,codex --scope global --yes
```

`sf setup` copies the skill's markdown only; the skill expects `sf` on PATH. Another program named `sf` (for example the Salesforce CLI) must not come first on PATH.
