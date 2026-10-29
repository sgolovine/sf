---
name: sf-validate
description: Validate an sf Story's branch in this repository (sf itself) - run the checks, verify every acceptance criterion, take screenshots of web UI changes, and open or update its pull request. The PR is marked ready when validation passes and left as a draft, with the failures commented on it, when it does not. Returns Pass, Fail, or Blocked. Use when an sf Worker runs the In Validation Stage, or when asked to validate a Story such as DEV-12.
---

# sf-validate

Check independently that the Story's branch does what its acceptance criteria say, and publish the result as its pull request. Do not fix code: failures go back to development.

## Input

- The Story in your Worker Brief. Its `## Refinement` Acceptance Criteria are what you validate against.
- `pr_url`, if an earlier round opened the PR. If it is empty, look it up with `gh pr list --head sf/<KEY> --state open`.
- The Stage's HIL comment: if it is set, a human has resolved an earlier blocker. Read it as context.

Change the Story only with the sf commands in the brief, and never edit files under `.sf`. When you run outside a Worker, use `pnpm sf:dev story ...` from the repository root.

## Steps

1. In the Story Worktree, run `git fetch --prune` and confirm the branch has no uncommitted changes and matches `origin/sf/<KEY>`. Uncommitted or unpushed work is a failure: development must commit and push it. Record the head SHA you validate.
2. Run `pnpm install` if needed, then `pnpm check` and `pnpm test`. Run `pnpm build` when the build, the CLI entry point, or `src/web` changed. Record each command and its result.
3. Verify every acceptance criterion with evidence: a test that covers it, a command you ran with its output (use `pnpm sf:dev` against a temporary Project), or the running app.
4. If the change touches the web UI (`src/web`), capture screenshots as described in [references/screenshots.md](references/screenshots.md).
5. Open or update the PR:
   - If none exists, run `gh pr create --draft --base master --head sf/<KEY> --title "<KEY>: <Story title>" --body-file <file>`.
   - Otherwise, update its body with `gh pr edit <n> --body-file <file>`.
   - The body holds: a summary, `Story: <KEY>`, the acceptance criteria with evidence for each, the validation commands with their results, a `## Screenshots` section (images, or one line saying why there are none), and known gaps.
6. Publish the result:
   - **Pass:** every check passes and every criterion is met. Run `gh pr ready <n>` and post a short summary comment naming the validated SHA.
   - **Fail:** if the PR is not already a draft, convert it back with `gh pr ready <n> --undo`. Post one review with event `COMMENT` through `gh api repos/sgolovine/sf/pulls/<n>/reviews`: put each failure that points at a changed line as an inline comment, and put the summary in the body (the SHA, each failed check with the relevant output, each unmet criterion, and what development must fix).

## Verdict

- **Pass:** the PR URL and the validated SHA.
- **Fail:** the PR URL and the failures, which are already posted on the PR.
- **Blocked:** validation could not run, for example because `gh` is not authenticated, the push or the PR call failed, or the app would not start for screenshots. Give the exact command and error, and keep any screenshots you captured.
