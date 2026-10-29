import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Runs git with `args` in `cwd` and resolves to trimmed stdout. Rejects on a non-zero exit. */
export type Git = (args: string[], cwd: string) => Promise<string>;

export const runGit: Git = (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile("git", args, { cwd, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args.join(" ")}: ${(stderr || err.message).trim()}`));
      else resolve(stdout.trim());
    });
  });

/** `<parent>/<repo>-sf-worktrees/<KEY>`. */
export function worktreePath(root: string, key: string) {
  return path.join(path.dirname(root), `${path.basename(root)}-sf-worktrees`, key);
}

export function storyBranch(key: string) {
  return `sf/${key}`;
}

/** The configured branch, else origin's HEAD, else `main`, else `master`. */
export async function resolveBaseBranch(git: Git, root: string, configured: string | null): Promise<string> {
  if (configured) return configured;
  try {
    return (await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], root)).replace(/^origin\//, "");
  } catch {
    // No origin HEAD; fall through to local branches.
  }
  if (await branchExists(git, root, "main")) return "main";
  if (await branchExists(git, root, "master")) return "master";
  return "main";
}

/** Creates the Story Worktree, or reuses it when git already has it. */
export async function ensureWorktree(git: Git, root: string, key: string, base: string) {
  const wtPath = worktreePath(root, key);
  const branch = storyBranch(key);
  if (await hasWorktree(git, root, wtPath)) return { path: wtPath, branch, created: false };
  fs.mkdirSync(path.dirname(wtPath), { recursive: true });
  if (await branchExists(git, root, branch)) await git(["worktree", "add", wtPath, branch], root);
  else await git(["worktree", "add", "-b", branch, wtPath, base], root);
  return { path: wtPath, branch, created: true };
}

export type CleanupResult = { removed: boolean; path: string; branch: string; reason?: string };

/**
 * Removes the Story Worktree when it is clean and pushed (or when `force` is
 * set), keeping the branch. Otherwise returns the reason it was kept.
 */
export async function cleanupWorktree(
  git: Git,
  root: string,
  key: string,
  base: string,
  force = false,
): Promise<CleanupResult> {
  const wtPath = worktreePath(root, key);
  const result = { path: wtPath, branch: storyBranch(key) };
  if (!(await hasWorktree(git, root, wtPath))) return { ...result, removed: false };
  if (!force) {
    if (await git(["status", "--porcelain"], wtPath))
      return { ...result, removed: false, reason: "uncommitted changes" };
    if (await git(["rev-list", "HEAD", "--not", "--remotes", base], wtPath))
      return { ...result, removed: false, reason: "unpushed commits" };
  }
  await git(["worktree", "remove", ...(force ? ["--force"] : []), wtPath], root);
  return { ...result, removed: true };
}

async function hasWorktree(git: Git, root: string, wtPath: string) {
  const list = await git(["worktree", "list", "--porcelain"], root);
  const wanted = new Set([wtPath, realpath(wtPath)]);
  return list.split("\n").some((line) => line.startsWith("worktree ") && wanted.has(line.slice(9)));
}

async function branchExists(git: Git, root: string, branch: string) {
  try {
    await git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], root);
    return true;
  } catch {
    return false;
  }
}

function realpath(p: string) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}
