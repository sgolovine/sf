---
name: sf-refine
description: Refine an sf Story for this repository (sf itself) so it can be developed without guessing - fill the gaps from the code and docs, write a Refinement section with acceptance criteria, and split off follow-up Stories. Returns Ready or Blocked. Use when an sf Worker runs the In Refinement Stage, or when asked to refine a Story such as DEV-12.
---

# sf-refine

Turn a Story into something a developer can build and a reviewer can check. Be permissive: when the Story leaves a choice open, pick the option that best fits the repository and record it as an assumption. Stop only when the Story cannot be understood at all.

## Input

The Story in your Worker Brief: title, fields, and body. If the Stage's HIL comment is set, a human has answered an earlier question there or in the body; use the answer.

Read and update the Story only with the sf commands in the brief, and never edit files under `.sf`. When you run outside a Worker, use `pnpm sf:dev story show|update|create ...` from the repository root.

## Steps

1. Read `CONTEXT.md` for the domain language, the specs in `docs/specs/` and ADRs in `docs/adr/` that the Story touches, and the code it affects.
2. Work out what the author wants. Fill every gap the code, docs, or conventions can answer. For open product or UX choices, pick the option that fits existing behavior.
3. If the Story is too large for one reviewable PR, keep the first coherent slice in this Story and create a follow-up Story in Backlog for each remaining slice. Give each one enough context to be refined on its own, and list their keys.
4. Write the `## Refinement` section below the author's text and keep that text unchanged. If a `## Refinement` section already exists, replace it.

   ```markdown
   ## Refinement

   ### Outcome
   What a user or agent can see or do once this is done.

   ### Scope
   In: ...
   Out: ...

   ### Acceptance Criteria
   - [ ] Each one checkable against the code, tests, or running app.

   ### Touch Points
   Files, modules, commands, routes, and screens that will change.

   ### Assumptions
   Each choice you made that the author did not state.

   ### Follow-ups
   Keys of the Stories split off, if any.
   ```

5. Save the body with `--body-file`.

Write no code and create no branches or PRs.

## Dependency waits and human input

Start by showing the current Story and rereading prerequisite Stories and delivered changes. A wake-up resumes this Stage; reconcile its existing work before advancing.

- **Waiting on dependencies:** for an observable Story prerequisite, persist the complete dependency list and release atomically with `sf story wait <KEY> --depends-on <KEY,KEY> --worker <id> --project <root>`. Save the current Stage's work first; commit and push finished code if applicable. Do not set HIL or Move. sf queues this Stage when all prerequisites are Done, subject to prompt, Claim, HIL and capacity rules. Already-Done prerequisites can resume immediately.
- **Needs human input:** reserve HIL for a concrete human decision/action (access, scope, configuration, or an error the Worker cannot fix). Name the action in the Stage's comment, keep separate dependencies, set the flag and release. Never infer that dependency completion permits clearing an existing human request.
- Retry or fix routine recoverable errors within the Stage. A failed command alone does not imply a human is needed. Report an unresolved failure precisely if it prevents finishing.

## Verdict

- **Ready:** the Refinement section is saved. This is the normal result.
- **Blocked:** the Story cannot be understood even with assumptions (no discernible goal, or a goal that contradicts itself), or a failure needs a concrete human action. Give the exact question or error, the options you see, and your recommendation.
