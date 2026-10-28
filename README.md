# sf

Build and run a software factory.

sf has three parts:

- **CLI** (`packages/cli`): `sf setup` installs the `sf-factory` skill (and optional skills) for Claude Code, Codex, or OpenCode.
- **Skill** (`skills/sf-factory`): turns an agent thread into the _host thread_. It checks capabilities, starts the web interface, watches files, and carries out commands from the interface.
- **Web interface** (`packages/web` + `packages/server`): a React + TanStack Query UI and an Express server. The UI sends commands such as "spawn a new thread with this prompt" to the host thread.

## Layout

```
packages/
  protocol/  shared types, routes, and command builders (UI ⇄ server ⇄ host)
  server/    Express API + `sf-factory` host CLI (bundled into the skill)
  web/       React UI; `src/api` has the client and hooks
  cli/       `sf setup`
skills/
  sf-factory/  SKILL.md and references (source)
scripts/
  build-skill.mjs  bundles the skill into dist/skills/sf-factory
```

## How the host thread and the UI talk

```
UI ── POST /api/commands ──▶ server queue ◀── sf-factory next (long-poll) ── host thread
UI ◀── GET /api/events (SSE) ── server ◀── sf-factory done | fail | say ──── host thread
```

1. The UI enqueues a `HostCommand` (`thread.spawn`, `subagent.spawn`, `host.instruct`).
2. The host runs `sf-factory next`, which blocks until it claims a command.
3. The host does the work and reports back with `sf-factory done <id> --result …` or `fail`.
4. Every state change streams to the UI over server-sent events.

UI helpers (`packages/web/src/api`):

```ts
sfApi.spawnThread("Add dark mode", { workspace: "worktree", branch: "feat/dark-mode" });
sfApi.spawnSubagent("Audit the auth module");
sfApi.instruct("Pause after the current task");

const spawnThread = useSpawnThread();   // TanStack mutation
spawnThread.mutate({ prompt: "Add dark mode" });
const { data: session } = useSession(); // live state: host, commands, messages, file changes
```

The server listens on `127.0.0.1` only. Each `/api` call needs the session token (`x-sf-token` header, or `?t=` for SSE). The printed UI URL includes the token.

## Development

```sh
pnpm install
pnpm dev            # Express on :4317 + Vite on :5173 → http://localhost:5173/?t=dev
pnpm typecheck
```

`pnpm dev:server` and `pnpm dev:web` run each part on its own. When the dev server is running, the host CLI (`node --import tsx packages/server/src/main.ts <cmd>`, or the built script) connects to it for the same workspace.

## Build

```sh
pnpm build
```

This builds the UI into `dist/skills/sf-factory/assets/ui`. It bundles the server and host CLI into `dist/skills/sf-factory/scripts/sf-factory.mjs`, a single file with no runtime dependencies. Then it builds the CLI and ships the skills with it. In production, `sf-factory start` starts a detached server that serves the UI.

```sh
pnpm sf setup                                   # interactive
pnpm sf setup --agents claude-code,codex --scope global --yes
```
