---
name: sf-review
description: Review an sf Story's validated pull request in this repository (sf itself) before merging - check it in context against the Story's acceptance criteria and for correctness, regressions, security, and test gaps, post a review with inline findings, and resolve earlier threads that are fixed. Returns Approve, Changes Needed, or Blocked. Use when an sf Worker runs the In Review Stage, or when asked to review a Story's PR such as DEV-12.
---

# sf-review

Decide whether a Story's PR can merge. Review the change in context, not only the patch. Report only problems the PR introduces that have a concrete failure and a fix the developer can act on. Do not edit code or push commits.

## Input

- The Story in your Worker Brief. Its `## Refinement` Acceptance Criteria are what the PR must deliver.
- `pr_url`. If it is empty, look it up with `gh pr list --head sf/<KEY> --state open`. If there is no PR, the verdict is Blocked.
- The Stage's HIL comment: if it is set, a human has resolved an earlier blocker. Read it as context.

Change the Story only with the sf commands in the brief, and never edit files under `.sf`. When you run outside a Worker, use `pnpm sf:dev story ...` from the repository root.

## Evidence

1. `gh pr view <n> --json number,url,state,isDraft,baseRefName,headRefOid,mergeable,mergeStateStatus,reviews,comments`. Record the head SHA you review.
2. Read every review thread, with its resolution state:

   ```sh
   gh api graphql -F n=<n> -f query='query($n:Int!){repository(owner:"sgolovine",name:"sf"){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved path line comments(first:20){nodes{author{login} body}}}}}}}'
   ```

3. In the Story Worktree, fetch and confirm `HEAD` matches the PR head.
4. Review the whole diff, `git diff $(git merge-base origin/master HEAD)...HEAD`, even when this is a re-review, and list every changed file. Read the surrounding code, callers, tests, specs, and ADRs; do not judge behavior from the diff alone.
5. Run `pnpm install` if needed, then `pnpm check` and `pnpm test`, plus `pnpm build` when the build, the CLI, or the UI changed.

## What to check

- **Acceptance:** each criterion is met, with evidence. An unmet criterion is a finding.
- **Correctness:** boundaries, empty and error paths, state transitions, Claims and Moves, HIL, races, and cleanup after a failure.
- **Contracts:** CLI flags and output, HTTP routes, the Story file format, `.sf` config compatibility, and the ADRs in `docs/adr/`.
- **Security:** how commands are built, path handling, the auth token, and secrets in logs or output.
- **Tests and docs:** changed behavior is tested, and `CONTEXT.md`, the specs, and the skills match what the code now does.
- **Scope:** unrelated changes, generated noise, or files under `.sf` committed by the PR.
- **Mergeability:** a draft PR, a merge conflict with `master`, or a failing check is a finding.

Admit a finding only if the PR introduces it, a specific input or state triggers it, code or a check supports it, it matters, the developer can act on it, and it points at a changed line. Drop style preferences, problems that already existed, vague risks, and duplicates of threads that are still open.

```markdown
### [P1] Imperative title
- Location: `path:line`
- Evidence: the input or state that triggers it, and what the code does
- Impact: the concrete consequence
- Fix: the smallest change that resolves it
```

`P0` breaks everything. `P1` breaks a core workflow or data. `P2` is real but limited. `P3` has low impact. A finding at any priority means Changes Needed.

## Earlier threads

For each unresolved thread from earlier rounds, check the current code. If the problem is fixed, or the developer's reply settles it, resolve the thread:

```sh
gh api graphql -F id=<thread id> -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}'
```

If it still stands, leave the thread open, reply saying why, and count it as a finding.

## Submit

Confirm the PR head is still the SHA you reviewed; if it moved, review the new commits first. Post one review through `gh api repos/sgolovine/sf/pulls/<n>/reviews` with event `COMMENT`, because GitHub does not let the author approve or request changes on their own PR. Put each new finding as an inline comment on its changed line. In the review body, give the verdict, the reviewed SHA, the files covered, and the commands you ran with their results.

## Verdict

- **Approve:** no findings, every criterion is met, the checks pass, and the PR is open, not a draft, and mergeable.
- **Changes Needed:** the findings, which are already on the PR.
- **Blocked:** the review could not run because there is no PR, no GitHub access, or a check could not run for environment reasons. Give the exact reason.

Report the verdict, the review URL, and the reviewed SHA.
