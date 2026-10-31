# Dependency waits: upgrade and migration

Use `pnpm sf:dev` from the upgraded source checkout for these commands (or the updated installed `sf`). The shared service handles both online and offline writes. Do not use a new CLI against an old running server: stop/restart that server with the upgraded source before migration, or perform migration offline and start the upgraded server afterwards. Back up the Project through normal Git procedures. Never edit Story files or infer dependencies/permission to clear HIL automatically from comment text.

## Install the factory prompts

The four repository templates preserve Stage outcomes and distinguish dependency waiting from human input. Review any locally customized prompt before replacing it. From the upgraded repository, use its supported CLI and the authoritative Project root:

```sh
pnpm sf:dev stage set DEV in_refinement --prompt-file .agents/stage-prompts/in_refinement.md --project /abs/project
pnpm sf:dev stage set DEV in_progress --prompt-file .agents/stage-prompts/in_progress.md --project /abs/project
pnpm sf:dev stage set DEV in_validation --prompt-file .agents/stage-prompts/in_validation.md --project /abs/project
pnpm sf:dev stage set DEV in_review --prompt-file .agents/stage-prompts/in_review.md --project /abs/project
```

These replace prompt text without changing enabled settings or HIL configuration. Running Workers retain their delivered briefs; future Workers receive the new instructions. Preserve existing retry thresholds and local adaptations when applying to another factory.

## Review before changing each hold

1. Run `story show <KEY> --json --project /abs/project` immediately before each update. Read the current Stage, Claim, fields, full body, and each prerequisite's current state. Do not overwrite a newly changed hold, or interfere with an active Worker. If the current evidence differs from this runbook, reevaluate it first.
2. Confirm the intended dependency list with the Story's delivery requirements. Use explicit same-Project keys; no arbitrary external condition monitoring is supported.
3. Set dependencies with `story update --depends-on ...`. For confirmed dependency-only holds, the same update can set the current Stage's HIL flag false. Preserve the HIL comment as historical context; do not delete genuine requests/comments. If there is any separate human decision/action, leave HIL true and its comment intact.
4. Read `story show --json` again to verify keys, unresolved prerequisites, HIL and Claim/queue status. Completion resumes the **current Stage**; it must reconcile delivered contracts before advancing. Clearing a dependency-only HIL with already-Done dependencies can start a Worker immediately.

## DEV-9 through DEV-12

Inspection on 2026-10-31 found DEV-7 Done; DEV-9/10/11/12 in refinement with HIL true. This is an audit snapshot, not permission to reuse stale state. The sequence is DEV-7 → DEV-9 → DEV-10 → DEV-11 → DEV-12. Explicit lists below preserve each Story's stated delivery requirements.

| Story | Dependencies | HIL treatment after fresh inspection |
| --- | --- | --- |
| DEV-9 | DEV-7 | Existing hold only requests DEV-7 delivery/reconciliation. Clear only if that remains the complete request. |
| DEV-10 | DEV-7, DEV-9 | Existing hold only requests prerequisite delivery/reconciliation. Clear only if still dependency-only. |
| DEV-11 | DEV-7, DEV-9, DEV-10 | Keep HIL: it separately requires a verified compatible public integration, configured prelinked target, and secure Worker/Claim-scoped channel. Clear only after those actions are actually resolved. |
| DEV-12 | DEV-7, DEV-9, DEV-10, DEV-11 | Encode dependencies; preserve HIL until its compatible linked test-target requirement is confirmed resolved or confirmed to belong solely to delivered DEV-11 work. Do not guess that access exists. |

After freshly confirming those classifications, use the authoritative Project root. The existing comments are deliberately preserved:

```sh
pnpm sf:dev story show DEV-7 --json --project /abs/project
pnpm sf:dev story show DEV-9 --json --project /abs/project
pnpm sf:dev story update DEV-9 --depends-on DEV-7 --field requires_refinement_hil=false --project /abs/project
pnpm sf:dev story show DEV-10 --json --project /abs/project
pnpm sf:dev story update DEV-10 --depends-on DEV-7,DEV-9 --field requires_refinement_hil=false --project /abs/project
pnpm sf:dev story show DEV-11 --json --project /abs/project
pnpm sf:dev story update DEV-11 --depends-on DEV-7,DEV-9,DEV-10 --project /abs/project
pnpm sf:dev story show DEV-12 --json --project /abs/project
pnpm sf:dev story update DEV-12 --depends-on DEV-7,DEV-9,DEV-10,DEV-11 --project /abs/project
```

Run each inspected update individually, then verify the resulting Story before continuing. Do not paste the block as an unattended bulk migration. DEV-9 should resume refinement automatically after its dependency-only flag is cleared while DEV-7 is Done. DEV-10 waits for DEV-9. DEV-11's human hold remains even after all prerequisites finish. No Story is automatically Moved to development.

Implementation regression tests exercise this wake behavior and independent holds with disposable Projects. The live migration must run on the upgraded authoritative service; this branch does not replace the Supervisor's running server during development.
