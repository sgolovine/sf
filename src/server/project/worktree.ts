import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Runs git with `args` in `cwd` and resolves to trimmed stdout. Rejects on a non-zero exit. */
export type Git = (args: string[], cwd: string) => Promise<string>;

export const runGit: Git = (args, cwd) =>
  new Promise((resolve, reject) => {
    // Never wait on a credential prompt: sf runs git unattended.
    const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
    execFile("git", args, { cwd, encoding: "utf8", env }, (err, stdout, stderr) => {
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

export type CleanupResult = {
  removed: boolean;
  path: string;
  branch: string;
  /** Why the worktree was kept. */
  reason?: string;
  /** Set when `deleteBranch` was asked for. */
  branchDeleted?: boolean;
  /** Why the branch was kept. */
  branchReason?: string;
};

/**
 * Fetches (pruning gone remote branches) so a branch merged on the remote is
 * seen as pushed, then removes the Story Worktree when it is clean and pushed
 * (or when `force` is set). Otherwise returns the reason it was kept. With
 * `deleteBranch`, then deletes the branch with `git branch -d`, which refuses
 * unmerged branches; the refusal is returned as `branchReason`.
 */
export async function cleanupWorktree(
  git: Git,
  root: string,
  key: string,
  base: string,
  { force = false, deleteBranch = false }: { force?: boolean; deleteBranch?: boolean } = {},
): Promise<CleanupResult> {
  const wtPath = worktreePath(root, key);
  const branch = storyBranch(key);
  const result = { path: wtPath, branch };
  try {
    await git(["fetch", "--prune"], root);
  } catch {
    // No remote, or it is unreachable: judge with the refs we have.
  }
  if (await hasWorktree(git, root, wtPath)) {
    if (!force) {
      if (await git(["status", "--porcelain"], wtPath))
        return { ...result, removed: false, reason: "uncommitted changes" };
      if (await git(["rev-list", "HEAD", "--not", "--remotes", base], wtPath))
        return { ...result, removed: false, reason: "unpushed commits" };
    }
    await git(["worktree", "remove", ...(force ? ["--force"] : []), wtPath], root);
    return { ...result, removed: true, ...(deleteBranch ? await deleteMergedBranch(git, root, branch) : {}) };
  }
  return { ...result, removed: false, ...(deleteBranch ? await deleteMergedBranch(git, root, branch) : {}) };
}

/** `git branch -d`: deletes the branch only if git sees it as merged. */
async function deleteMergedBranch(git: Git, root: string, branch: string) {
  if (!(await branchExists(git, root, branch))) return { branchDeleted: false };
  try {
    await git(["branch", "-d", branch], root);
    return { branchDeleted: true };
  } catch (err) {
    return {
      branchDeleted: false,
      branchReason: (err as Error).message.replace(/^git branch -d \S+: (error: )?/, "").split("\n")[0],
    };
  }
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
