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
