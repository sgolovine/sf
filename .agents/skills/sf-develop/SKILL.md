---
name: sf-develop
description: Develop a refined sf Story in this repository (sf itself) inside its Story Worktree - research, plan, implement, and push focused checkpoint commits. When a Story comes back from validation or review, fix the findings left on its pull request. Returns Done or Blocked. Use when an sf Worker runs the In Development Stage, or when asked to develop a Story such as DEV-12.
---

# sf-develop

Implement one Story so that it meets its acceptance criteria. Validation, screenshots, and the pull request are the next Stage's job (sf-validate), but leave the branch in a state that will pass them.

## Input

- The Story in your Worker Brief. Its `## Refinement` section, and in particular the Acceptance Criteria, defines done.
- `pr_url`: if it is set, an earlier round already opened a PR. Validation or review sent the Story back, and the findings on that PR are your work list (see [Rework](#rework)).
- The Stage's HIL comment: if it is set, a human has resolved an earlier blocker. Read it as context.

Change the Story only with the sf commands in the brief, and never edit or commit files under `.sf`. When you run outside a Worker, use `pnpm sf:dev story ...` from the repository root.

## Workspace

Work only in the Story Worktree named in the brief, on its `sf/<KEY>` branch. sf created it from the base branch. Start with `git status --short --branch` and `git fetch --prune`, and run `pnpm install` if `node_modules` is missing. Never commit to `master`.

## Steps

1. **Research.** Read `CONTEXT.md`, the specs and ADRs the Story touches, and the code and tests around each touch point. Follow the repository's patterns for naming, structure, errors, and tests.
2. **Plan.** Write down the ordered steps, the files involved, and how each acceptance criterion will be shown to hold. If something the Story leaves open would change what gets built and the code cannot settle it, stop and report Blocked rather than guess.
3. **Implement.** Keep changes scoped to the Story: no opportunistic refactors, formatting sweeps, or dependency upgrades. Add or update tests in `test/` for the behavior you change. Update `CONTEXT.md`, the specs, the skills in `skills/`, and the docs when the behavior they describe changes.
4. **Commit and push as you go.** Make one commit per coherent milestone, with a Conventional Commit message, and review the staged diff before each one. Push after the first commit with `git push -u origin sf/<KEY>`, and again after every later commit. Never amend, rebase, or force-push commits you have already pushed.
5. **Stay current.** Before finishing, merge the fetched remote default branch (`origin/main` in this repository), resolve any conflicts while keeping both sides' intent, and push.
6. **Self-check.** Run `pnpm check` and `pnpm test`, and fix what fails. Do not hand over a branch you know is broken.

## Rework

When `pr_url` is set, read what sent the Story back:

- the latest sf-validate or sf-review summary on the PR (`gh pr view <pr_url> --comments`)
- every unresolved review thread:

  ```sh
  gh api graphql -F n=<number> -f query='query($n:Int!){repository(owner:"sgolovine",name:"sf"){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved path line comments(first:20){nodes{author{login} body}}}}}}}'
  ```

Check each finding against the code. Fix it, with a test where one is practical, or decide that you disagree and gather evidence. Then reply on each thread with what you did or why you did not change it:

```sh
gh api graphql -F id=<thread id> -F body='<reply>' -f query='mutation($id:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id,body:$body}){comment{id}}}'
```

Answer findings that have no thread in a single PR comment. Never resolve a thread; the reviewer resolves it.

## Dependency waits and human input

Start by showing the current Story and rereading prerequisite Stories and delivered changes. A wake-up resumes this Stage; reconcile its existing work before advancing.

- **Waiting on dependencies:** for an observable Story prerequisite, persist the complete dependency list and release atomically with `sf story wait <KEY> --depends-on <KEY,KEY> --worker <id> --project <root>`. Save the current Stage's work first; commit and push finished code if applicable. Do not set HIL or Move. sf queues this Stage when all prerequisites are Done, subject to prompt, Claim, HIL and capacity rules. Already-Done prerequisites can resume immediately.
- **Needs human input:** reserve HIL for a concrete human decision/action (access, scope, configuration, or an error the Worker cannot fix). Name the action in the Stage's comment, keep separate dependencies, set the flag and release. Never infer that dependency completion permits clearing an existing human request.
- Retry or fix routine recoverable errors within the Stage. A failed command alone does not imply a human is needed. Report an unresolved failure precisely if it prevents finishing.

## Verdict

- **Done:** every step is complete, every finding is answered, and the branch is pushed. Report the commits, the checks you ran, and how you handled each finding.
- **Blocked:** a decision you cannot make, a check you cannot fix, or missing access. Say what stopped you, what you tried, and what a human needs to do, and leave all finished work committed and pushed.
