import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** A fresh temp directory, removed when the process exits. */
export function tempDir(prefix = "sf-test-"): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** A git repo with one commit on `main`, pushed to a bare `origin`. Returns the repo path. */
export function tempRepo(): string {
  const base = tempDir("sf-repo-");
  const origin = path.join(base, "origin.git");
  const repo = path.join(base, "repo");
  git(base, "init", "--bare", "-b", "main", origin);
  git(base, "init", "-b", "main", repo);
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test");
  fs.writeFileSync(path.join(repo, "README.md"), "# test\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "init");
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-u", "origin", "main");
  git(repo, "remote", "set-head", "origin", "main");
  return repo;
}

import type { ProjectConfig } from "#model/config";
import { createService, type ServiceOptions, type SpawnRequest } from "../src/server/project/service.ts";
import { sfPaths } from "../src/server/project/paths.ts";

/**
 * A Project with Board "Development" (DEV) whose `todo` and `in_progress`
 * Stages have enabled prompts. Spawns are recorded instead of queued.
 */
export async function setupProject(options: Partial<ServiceOptions> & { config?: Partial<ProjectConfig> } = {}) {
  const root = options.root ?? tempDir();
  const spawns: SpawnRequest[] = [];
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => void (t += ms) };
  const make = (online: boolean) =>
    createService({
      root,
      online,
      now: clock.now,
      git: async () => "",
      onSpawn: (r) => {
        spawns.push(r);
        return `c${spawns.length}`;
      },
      spawnMode: () => "thread",
      sf: "node /abs/sf.mjs",
      ...options,
    });
  const svc = make(options.online ?? true);
  svc.init();
  if (options.config) {
    const file = sfPaths(root).config;
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), ...options.config }));
  }
  await svc.createBoard("Development", "DEV");
  await svc.updateStage("DEV", "todo", { promptEnabled: true, prompt: "Plan the Story." });
  await svc.updateStage("DEV", "in_progress", { promptEnabled: true, prompt: "Build the Story." });
  return { root, svc, spawns, clock, make };
}

export const user = { kind: "user" } as const;
export const worker = (id: string) => ({ kind: "worker", id }) as const;
