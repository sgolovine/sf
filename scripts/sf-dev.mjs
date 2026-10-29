#!/usr/bin/env node
// Runs the sf-factory CLI from TypeScript source, for the project-internal sf-dev
// skill. Same commands as dist/skills/sf-factory/scripts/sf-factory.mjs, no
// `pnpm build`. `start` first rebuilds the UI into dist/sf-dev/ui.
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const uiDir = path.join(root, "dist/sf-dev/ui");
const args = process.argv.slice(2);

if (args[0] === "start") {
  // Vite output goes to stderr so `start` prints only the URL on stdout.
  const ui = spawnSync("pnpm", ["--filter", "@sf/web", "exec", "vite", "build", "--outDir", uiDir, "--logLevel", "warn"], {
    cwd: root,
    stdio: ["ignore", process.stderr, "inherit"],
  });
  if (ui.status !== 0) process.exit(ui.status ?? 1);
}

// An absolute loader path keeps the tsx loader working in the detached server and
// in Worker Briefs, whose commands run from Story Worktrees without node_modules.
const result = spawnSync(
  process.execPath,
  ["--import", import.meta.resolve("tsx"), path.join(root, "packages/server/src/main.ts"), ...args],
  { stdio: "inherit", env: { ...process.env, SF_UI_DIR: process.env.SF_UI_DIR ?? uiDir } },
);
process.exit(result.status ?? 1);
