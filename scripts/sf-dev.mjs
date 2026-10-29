#!/usr/bin/env node
// Runs the sf CLI from TypeScript source, for the project-internal sf-dev skill.
// Same commands as dist/sf.mjs, no `pnpm build`. `start` first rebuilds the UI
// into dist/ui. The CLI runs in this process, so signals and the parent-death
// check behave as they do for dist/sf.mjs.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { register } from "tsx/esm/api";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);

if (args[0] === "start" && !args.some((a) => a === "--dev" || a.startsWith("--ui-dir"))) {
  // Vite output goes to stderr so stdout stays sf's own.
  const ui = spawnSync("pnpm", ["exec", "vite", "build", "--logLevel", "warn"], {
    cwd: root,
    stdio: ["ignore", process.stderr, "inherit"],
  });
  if (ui.status !== 0) process.exit(ui.status ?? 1);
}

// tsx resolves from this file, so this works from Story Worktrees without node_modules.
register();
await import(pathToFileURL(path.join(root, "src/cli/main.ts")).href);
