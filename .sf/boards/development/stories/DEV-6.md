---
title: Set conversation title when running `sf` skill.
stage: done
branch: sf/DEV-6
requires_refinement_hil: false
requires_dev_hil: false
pr_url: https://github.com/sgolovine/sf/pull/8
requires_validation_hil: false
requires_review_hil: false
---
When the user runs the `sf` skill in their agent. We should set the title of the conversation to "SF Supervisor". 

Only do this if the harness supports it, otherwise skip and accept default title.

## Refinement

### Outcome

Starting the `sf` skill names the current Supervisor conversation `SF Supervisor` when the harness exposes a supported way to rename that conversation. Starting sf still works when conversation renaming is unavailable.

### Scope

In: add a best-effort rename instruction to the existing capability check in `skills/sf/SKILL.md`, before starting sf. Use the current harness/app's documented tools or commands to rename the current conversation. Include a concrete example for T3 Code, whose available `t3_thread_update` tool accepts `action: "rename"`, `title: "SF Supervisor"`, and no `threadId` to target the calling conversation.

Out: new CLI commands, server endpoints, persisted capability flags, harness adapters, changes to Worker titles, browser/document titles, or continuous enforcement of the title after startup.

### Acceptance Criteria

- [ ] The sf skill instructs the Supervisor to set the current conversation title to exactly `SF Supervisor` during startup when a supported rename capability is available.
- [ ] The instruction checks actual available/documented harness capabilities rather than inferring rename support from the agent name or from thread-spawning support. It targets the current Supervisor conversation and does not create or rename another thread.
- [ ] T3 Code guidance uses the documented `t3_thread_update` rename operation with the exact title and current-thread targeting; other harnesses can use their own supported equivalent without inventing tools or commands.
- [ ] If no supported rename operation is available, the skill skips renaming and continues startup with the existing/default title, without requiring a user response or installing tools. A rejected or failed rename is also nonblocking and does not lead to repeated retries.
- [ ] Existing sf startup, capability registration, Worker dispatch, and stop instructions remain valid. `.agents/skills/sf-dev/SKILL.md` continues to inherit this behavior by following the source sf skill.
- [ ] Validation inspects the final instructions for supported, unsupported, and failed-rename paths. Where a rename-capable harness is available, verify that invoking the skill changes only the Supervisor conversation title; otherwise record that live supported-harness validation was unavailable. Existing setup-copy coverage in `test/cli.test.ts` remains applicable; no new runtime feature or brittle assertion against exact prose is required.

### Touch Points

- `skills/sf/SKILL.md`: capability check/startup instructions; this is the source installed by `sf setup`.
- `.agents/skills/sf-dev/SKILL.md`: verify that its existing source-skill delegation and step references still work; change only if needed.
- `src/cli/targets.ts` and `test/cli.test.ts`: existing skill installation and copy coverage, for context and validation. No runtime changes expected.
- `CONTEXT.md`, `docs/specs/00-project-init.md`, `docs/specs/01-core-function.md`, and `docs/adr/0002-cli-first-foreground-server.md`: existing Supervisor and instruction-only skill architecture; no architectural change needed.

### Assumptions

- This is a skill instruction change: sf's CLI cannot directly rename an agent conversation, and the harness/app owns that operation.
- Apply the title when the user invokes the sf skill, including sf-dev through its existing delegation. An existing custom title may be replaced as requested; later user title edits need not be overridden.
- Renaming is optional presentation behavior, so an unavailable or failing rename must not prevent the factory from starting.

### Follow-ups

None. This fits one focused PR.
