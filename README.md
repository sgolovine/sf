# sf

Build and run a software factory.

sf has three parts:

- **CLI** (`packages/cli`): `sf setup` installs the `sf-factory` skill (and optional skills) for Claude Code, Codex, or OpenCode.
- **Skill** (`skills/sf-factory`): turns an agent thread into the _Supervisor_. It checks capabilities, starts the web interface, and spawns a Worker whenever a Story Moves into a Stage with an enabled Stage Prompt.
- **Web interface** (`packages/web` + `packages/server`): a React + TanStack Query kanban (Tailwind CSS v4 and shadcn/ui) and an Express server. A sidebar lists the Boards, with New Board at the bottom. Users create Stories and Move them on the Board; each Board's Board Settings page has tabs for Stages, Custom Fields (the Story schema), and Stage Prompts (with agent and model overrides). The server turns Moves into `worker.spawn` commands for the Supervisor.

## Layout

```
packages/
  protocol/  shared types, routes, and command builders (UI ⇄ server ⇄ Supervisor)
  server/    Express API + `sf-factory` CLI (bundled into the skill); src/project is the Story service
  web/       React UI; `src/api` has the client and hooks, `src/components/ui` the shadcn/ui components
  cli/       `sf setup`
skills/
  sf-factory/  SKILL.md and references (source)
scripts/
  build-skill.mjs  bundles the skill into dist/skills/sf-factory
```

## How the Supervisor, Workers, and the UI talk

```
UI ── Move / create Story ──▶ server ── Story service (.sf) ──▶ worker.spawn queue
                                  ◀── sf-factory next (long-poll) ── Supervisor ── spawns ──▶ Worker
UI ◀── GET /api/events (SSE) ── server ◀── sf-factory done | fail | say ─ Supervisor
                                  ◀── sf-factory story move|update|create|release --worker ── Worker
```

1. A Story enters a Stage with an enabled Stage Prompt. sf claims the Story for a new Worker id and queues a `worker.spawn` command (or queues the spawn, oldest first, when the Project is at `maxConcurrentWorkers`).
2. The Supervisor runs `sf-factory next`. The server creates or reuses the Story Worktree and hands out the command with the Worker Brief.
3. The Supervisor starts the Worker (a thread, or a subagent when it cannot start threads) and reports `sf-factory done <id> --result <thread id>`, or `fail`.
4. The Worker changes Stories only through `sf-factory story ... --worker <id> --project <root>`. Its Claim ends when it Moves or releases the Story, when the user force-releases it, or after the claim timeout.
5. Every state change streams to the UI over server-sent events.

UI helpers (`packages/web/src/api`):

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

Every Story change goes through `sf-factory` (UI, Supervisor, or Worker). With no server running, CLI commands write `.sf/` directly and queue spawns until the next `sf-factory start`. Hand edits show up in the UI live, but changing `stage:` by hand is not a Move and starts no Worker. Story Worktrees live next to the repository in `<repo>-sf-worktrees/<KEY>` on branch `sf/<KEY>`.

```sh
SF=dist/skills/sf-factory/scripts/sf-factory.mjs
node $SF board create Development --key DEV
node $SF stage set DEV todo --prompt-file prompts/plan.md --prompt-enabled true
node $SF story create DEV --title "Add dark mode" --stage todo   # spawns a Worker
node $SF story list
```

See [worker-commands.md](skills/sf-factory/references/worker-commands.md) for every Project command.

The server listens on `127.0.0.1` only. Each `/api` call needs the session token in the `authToken` header. The printed UI URL carries the token in its fragment so the browser can add the header without sending the token in the HTTP URL.

## Development

```sh
pnpm install
pnpm dev            # Express on :4317 + Vite on :5173 → http://localhost:5173/#authToken=dev
pnpm typecheck
pnpm test           # node --test with tsx
```

`pnpm dev:server` and `pnpm dev:web` run each part on its own. The dev server uses this repository as its Project. When it is running, the CLI (`node --import tsx packages/server/src/main.ts <cmd> --project .`, or the built script) connects to it.

To test the `sf-factory` skill without building, use the project-internal `sf-dev` skill (`.agents/skills/sf-dev`). It follows `skills/sf-factory/SKILL.md` from source and runs `scripts/sf-dev.mjs` (also `pnpm sf-dev <cmd>`), which runs the CLI and server from TypeScript and rebuilds the UI into `dist/sf-dev/ui` on `start`.

## Build

```sh
pnpm build
```

This builds the UI into `dist/skills/sf-factory/assets/ui`. It bundles the server and CLI into `dist/skills/sf-factory/scripts/sf-factory.mjs`, a single file with no runtime dependencies. Then it builds the CLI and ships the skills with it. In production, `sf-factory start` starts a detached server that serves the UI.

```sh
pnpm sf setup                                   # interactive
pnpm sf setup --agents claude-code,codex --scope global --yes
```
