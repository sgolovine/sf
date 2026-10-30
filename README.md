# sf

Build and run a software factory.

sf is a CLI first. One package builds one `sf` command:

- **CLI** (`src/cli`): `sf setup` installs the `sf` skill for Claude Code, Codex, or OpenCode. `sf start` runs the server in the foreground. The other commands (`sf next`, `sf done`, `sf story ...`) let the Supervisor and Workers talk to the server and change the Project.
- **Server** (`src/server`): an Express server that `sf start` runs in-process. It serves the built web interface, the API, and server-sent events, and turns Moves into `worker.spawn` commands for the Supervisor. `src/server/project` is the Story service.
- **Web interface** (`src/web`): a React + TanStack Query kanban (Tailwind CSS v4 and shadcn/ui). A sidebar lists the Boards, with New Board at the bottom. Users create Stories and Move them on the Board; each Board's Board Settings page has tabs for Stages, Custom Fields (the Story schema), Stage Prompts (with agent and model overrides), and Worker settings. Project settings are in the sidebar; every Story has a built-in model selector.
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
    stages/<stage-id>.md    Stage model frontmatter + Prompt text
    stories/DEV-1.md        YAML frontmatter (title, stage, branch, model, custom fields) + description
```

Every Story change goes through `sf` (UI, Supervisor, or Worker). With no server running, CLI commands write `.sf/` directly and queue spawns until the next `sf start`. Hand edits show up in the UI live, but changing `stage:` by hand is not a Move and starts no Worker. Story Worktrees live next to the repository in `<repo>-sf-worktrees/<KEY>` on branch `sf/<KEY>`.

```sh
sf board create Development --key DEV
sf stage set DEV todo --prompt-file prompts/plan.md --prompt-enabled true
sf story create DEV --title "Add dark mode" --stage todo   # spawns a Worker
sf story list
sf start --no-open      # runs until Ctrl-C; prints `sf ready: <url>`
```

Worker models inherit Story → current Stage → Board → Project → Supervisor default. Use `sf project set --model gpt-6.1-sol`, `sf board set DEV --model claude-opus-5-5`, `sf stage set DEV todo --model gpt-6-luna`, or Story create/update `--model <slug>`. Pass `--model ""` to clear a level. `sf project show`, `sf board show`, Stage set and Story show explain the effective model/source (and return catalogs with `--json`).

Project/Board JSON retain `worker.model` / `overrides.worker.model` and support custom `modelOptions: [{slug, label}]`; repeat `--model-option vendor/custom` on Project/Board set to add without selecting. Choices merge presets + Project customs + Board customs by exact slug; Board custom labels win, preset labels stay fixed. Labels default to slugs. Unknown saved slugs remain selectable. Stage/Story models use Markdown frontmatter; Stage prompt bodies exclude metadata. Legacy Stage JSON values migrate on that Stage's next update, preserving unrelated metadata. Missing/null/empty overrides inherit; with no selection sf omits the spawn model and displays “Supervisor default.” `model` cannot be redefined by custom fields; legacy conflicts require renaming before schema changes. See the [model formats and preset slugs](docs/specs/01-core-function.md#worker-models).

Settings changes affect the next Worker, including queue drain, offline replay, HIL wake, and retry. They do not restart active Workers. The Supervisor passes explicit model slugs unchanged or reports an unsupported selection visibly.

See [worker-commands.md](skills/sf/references/worker-commands.md) for every Project command.

The server listens on `127.0.0.1` only. Each `/api` call needs the session token in the `authToken` header. The printed UI URL carries the token in its fragment so the browser can add the header without sending the token in the HTTP URL.

### Story attachments

In a new or existing Story editor, drop/select multiple files or paste images anywhere in the dialog. Files remain pending until Save/Create; Cancel discards the selection. Reopen a Story to download saved files. Limits: **20 MiB per file, 40 MiB and 100 files per submission**.

```sh
sf story attachment add DEV-3 ./screenshot.png --project /path/to/project
sf story attachment list DEV-3 --project /path/to/project --json
sf story attachment get DEV-3 <attachment-id> --output ./download.png --project /path/to/project
```

Commands work online and offline. Workers append `--worker <id>` to validate and refresh their Claim. `add` accepts one regular file; `get` requires an existing output parent and never overwrites a file. JSON output contains metadata or an output path, never file bytes.

Files and `manifest.json` live in `.sf/boards/<board-id>/attachments/<Story-Key>/`, committed with Project content and independent of Story Worktrees. Opaque server ids identify files; original filenames are display metadata, so duplicate names coexist. No deletion/rename commands are provided.

The API accepts base64 `attachments: [{name, mediaType?, data}]` on Story POST/PATCH. Include a UUID `submissionId` and reuse the **same payload and id** when retrying an uncertain response; committed submissions are not repeated. Files commit before creation/HIL-clear triggers. Standalone POST/GET `/api/stories/<KEY>/attachments` adds one file/lists metadata; GET `/api/stories/<KEY>/attachments/<id>` downloads binary bytes. Worker requests include `worker` in the JSON body or query string. All operations require the `authToken` header. Story JSON requests are bounded at **60 MiB encoded**, with the same decoded per-file/batch limits above; other JSON routes retain their 1 MiB limit. HTML/SVG and all other files download as `application/octet-stream`, never as origin content.

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

### Delete a Story

Open an existing Story and click its trash icon to confirm permanent deletion, or run:

```sh
sf story delete DEV-12 --project /path/to/project
```

The CLI command deletes immediately without an interactive confirmation and accepts
`--json` and `--worker <id>`. Release any live Claim first, including your own Worker Claim.
Deletion removes the Story and its pending scheduling/status, but retains its Story
Worktree, git branch, and historical Worker records. There is no restore or undo.
Story Keys are never reused: each Board persists its numbering high-water mark
in committed `board.config.json`, independent of gitignored runtime state.
