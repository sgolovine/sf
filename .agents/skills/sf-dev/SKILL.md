---
name: sf-dev
description: Run the sf-factory skill from this repository's source, for developing and testing sf itself. No `pnpm build` and no copying into .agents/skills. Use when the user asks to run, start, or test sf-dev, or to test the sf-factory skill against the current source.
---

# sf-dev

Run the `sf-factory` skill as written in this repository's source, with the server and CLI running from TypeScript.

1. From the repository root, run `pnpm install` if `node_modules` is missing.
2. Read `skills/sf-factory/SKILL.md` and follow it exactly, with one change: `$SF` is the absolute path of `scripts/sf-dev.mjs` in this repository. Its references are in `skills/sf-factory/references/`.

`scripts/sf-dev.mjs` takes the same commands as the bundled `sf-factory.mjs`. On `start` it first rebuilds the UI into `dist/sf-dev/ui`.

Source changes take effect as follows:

- Skill text in `skills/sf-factory/`: reread the changed file.
- CLI code: on the next command.
- Server code: run `node "$SF" stop`, then `start` again.
- UI code: run `start` again, then reload the browser.
