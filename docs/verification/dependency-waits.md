# DEV-13 verification

Verified 2026-10-31 from the Story branch.

- `pnpm check`: passes Biome and both TypeScript projects.
- `pnpm test`: 124 tests pass, including 12 dependency regression tests and new CLI/HTTP cases.
- Dependency tests cover persistence, unrelated edits/clear, invalid graphs online/offline, same-Project cross-Board references, protected deletion and missing files, DEV-7 Done → DEV-9 current refinement Stage wake, chains, multiple/already-Done prerequisites, concurrent completions, restart/offline replay, atomic wait/release races, FIFO capacity/deduplication, queued reopens, active Worker preservation, independent HIL and brief-read failure recovery.
- CLI/HTTP tests exercise `--depends-on` create/update/clear, malformed/missing/cyclic references, wait release and stale Worker rejection, and online CLI server routing.
- Browser verification used a disposable Project via `pnpm sf:dev start`. The T3 preview opened but snapshot requests twice timed out (`Preview automation snapshot timed out after 15000ms.`); verification continued through the Playwright browser skill.
- Initial cards showed dependency keys and unresolved reasons. A mixed hold showed both “Waiting on dependencies: DEV-1” and “Needs a human”, with its access request. No Worker was reserved.
- Story editor showed the dependency input and hold reason. Saving self-reference DEV-2 rejected with `dependency cycle: DEV-2 → DEV-2`, preserving the editor; correcting to DEV-1 saved successfully.
- Moving DEV-1 to Done through the CLI removed dependency holds. DEV-2 reserved exactly one Worker in its existing TODO Stage. DEV-3 retained HIL and its access comment.
- With capacity set to one in the disposable fixture, clearing DEV-3's human flag through the editor showed “Waiting for Worker capacity”. Releasing DEV-2 reserved a Worker for DEV-3. This verified all three displayed wait states and their transitions. No external Worker was launched by this browser smoke test; reservation/command delivery and active Claim paths are covered in service/HTTP tests.

Screenshots are attached to DEV-13 (waiting, resumed, capacity). The disposable Project was intentionally not a Git repository, so moving its prerequisite to Done displayed the existing worktree-cleanup warning; this did not affect scheduling.

The [migration runbook](../dependency-waits.md) includes current inspected classifications and concrete CLI commands for DEV-9/10/11/12. Live holds and live Stage Prompts have not been replaced during branch development: the authoritative Supervisor still runs the previous service, which must be upgraded before installing the new prompts or writing dependencies. DEV-11's integration/access requirements and DEV-12's test-target question remain preserved. The runbook requires fresh inspection before every update; it never bulk-clears HIL or derives permission from comments automatically.
