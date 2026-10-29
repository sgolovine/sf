---
name: sf-dev
description: Run the sf skill from this repository's source, for developing and testing sf itself. No `pnpm build` and no global `sf` install. Use when the user asks to run, start, or test sf-dev, or to test the sf skill against the current source.
---

# sf-dev

Run the `sf` skill as written in this repository's source, with the sf CLI running from TypeScript.

1. From the repository root, run `pnpm install` if `node_modules` is missing.
2. Read `skills/sf/SKILL.md` and follow it exactly, with two changes:
   - Every `sf` command is `pnpm sf:dev`, run from the repository root. For example: `pnpm sf:dev start --agent ...`.
   - Skip its step 1 (Check the CLI).

   Its references are in `skills/sf/references/`.

`pnpm sf:dev` (which runs `scripts/sf-dev.mjs`) takes the same commands as `sf`. On `start` it first rebuilds the UI into `dist/ui`, then runs the server in its own process, so start it as a background process of this thread, as the skill says.

Source changes take effect as follows:

- Skill text in `skills/sf/`: reread the changed file.
- CLI code: on the next command.
- Server code: stop the background `start` process (or run `stop`), then `start` again.
- UI code: run `start` again, then reload the browser.
