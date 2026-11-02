# Machine scheduling verification (DEV-12, 2026-10-31)

This record checks the original eight DEV-7 feature criteria (listed in
[remote Workers](../remote-workers.md#implementation-sequence-and-feature-acceptance)) against the
delivered feature. Each row is **pass** (with the test or observed run), **unrun**, or **retired**
by the 2026-10-31 scope amendment. That amendment makes the Supervisor's harness own machine
handling: sf adds a machine request to the Worker launch request and does no remote discovery,
adapter, preflight, transport, preparation or cleanup. Retired and unrun rows are not passes.

Delivered by:

| Story | Merge |
| --- | --- |
| DEV-7 (compatibility report, boundary) | PR #11, `5d3df30` |
| DEV-9 (policy, persistence, pure selector) | PR #14, `1d93c24` |
| DEV-10 (execution ledger, reservations, FIFO, recovery) | PR #20, `495372e` |
| DEV-11 (machine request in `worker.spawn`) | PR #26, `0239e08` |
| DEV-12 (CLI/UI controls, status, this record) | branch `sf/DEV-12` |

Test files are under `test/`. Run them with `pnpm test`.

## 1. Legacy config and precedence

| Check | Result | Evidence |
| --- | --- | --- |
| Without `scheduling`, local only at `maxConcurrentWorkers` (default 3) | pass | `placement.test.ts` "pure first-fit fills 4 + 2 + 2 independent of the legacy cap"; `execution.test.ts` "simultaneous requests across Boards reserve each slot once" |
| With `scheduling`, per-machine caps replace the legacy total; no implicit overall cap | pass | `story-placement.test.ts` "scheduling replaces the legacy cap…"; `machine-scheduling.test.ts` "4+2+2 across Boards…" (legacy cap 1 ignored) |
| Config is validated with field paths, written atomically, and preserves unrelated config | pass | `config.test.ts` "scheduling validates complete shapes…"; `machine-scheduling.test.ts` "updateProject writes scheduling atomically…" |

## 2. Routing across Boards

| Check | Result | Evidence |
| --- | --- | --- |
| Order `[a, b, local]`, caps `4, 2, 2`: exactly 4 + 2 + 2 under concurrent requests across Boards, then queue | pass | `machine-scheduling.test.ts` "4+2+2 across Boards under concurrent requests…" |
| Local-only queues when local is full despite remote room | pass | same test; `execution.test.ts` "eligible FIFO skips full or unavailable pins…" |
| Pinned full/unavailable Stories do not block later eligible work; oldest eligible first; no cap exceeded | pass | `execution.test.ts` "eligible FIFO skips full or unavailable pins…" |

## 3. Overrides, clearing and caps

| Check | Result | Evidence |
| --- | --- | --- |
| CLI: inherit, local-only, required and preferred; inherit clears; omission preserves | pass | `machine-scheduling.test.ts` "offline CLI: project set/show scheduling and story placement flags", "online CLI and HTTP share validation…" |
| UI: Story editor Placement control and Project Settings scheduling section | pass (observed) | Run against a scratch Project on 2026-10-31: set placement, saw "(disabled)" and "(unresolved)" targets, saved an unrelated edit with an unresolved target, reordered by keyboard, and saw the reference-check error in the banner. Screenshots are taken in validation. |
| Persistence across reload/restart; unknown targets rejected; stale targets editable | pass | `story-placement.test.ts` "placement service validation, persistence and stale recovery" (online and offline) |
| Integer capacities, zero and cap lowering stop new reservations without stopping Workers | pass | `execution.test.ts` "cap 0 and lowered caps…"; `machine-scheduling.test.ts` "cap changes drain the queue and never stop running Workers" |
| Overrides apply only before reservation | pass | `machine-scheduling.test.ts` "the launch request carries required/preferred intent…" (edit after reservation keeps machine `a`; the next launch is local) |
| Referenced machines cannot be removed or remapped; disabling makes required Stories wait | pass | `machine-scheduling.test.ts` "reference checks reject orphaning edits…" |

## 4. Real linked target lifecycle

| Check | Result | Evidence |
| --- | --- | --- |
| The launch request carries "Use X Machine" with required/preferred intent and fallback | pass | `machine-scheduling.test.ts` "the launch request carries required/preferred intent from configured placement"; `brief.test.ts` "a selected remote appends delimited machine instructions…"; `execution.test.ts` "production remotes are requested from the harness…" |
| A real remote target runs the right project/worktree/model, mutates the authoritative Story, records remote links, and the next Stage consumes the published head | retired | 2026-10-31 amendment: the harness owns machine handling. sf records only Supervisor-reported task/thread IDs as text and builds no remote links. |
| Real linked-environment lifecycle run (versions, target identity, branch/head, task links) | retired, unrun | Superseded by the same amendment. See the [historical runbook](../remote-workers.md#real-target-test-runbook--unrun). |

## 5. Reclamation and stale Workers

| Check | Result | Evidence |
| --- | --- | --- |
| Move, release, confirmed failure, cancel and timeout reconcile capacity and wake eligible work | pass | `execution.test.ts` "a Worker's Move revokes authority…", "timeout and force-release keep an unknown reservation…", "cancellation during preparation never delivers…" |
| Unknown still-running work keeps occupancy and the branch fence | pass | `execution.test.ts` "timeout and force-release keep an unknown reservation…", "an unqualified failure after delivery stays occupied…" |
| Stale Workers cannot mutate | pass | `execution.test.ts` "an unqualified failure after delivery stays occupied; mismatched or stale reports change nothing"; `cli.test.ts` stale `--worker` exits 3 (`claim_gone`) |

## 6. Restart, reconnect and duplicates

| Check | Result | Evidence |
| --- | --- | --- |
| Restart preserves reservations and never redelivers a delivered launch | pass | `execution.test.ts` "restart recovery: republish undelivered intents once…", "publication failure keeps the reservation…" |
| Lost launch responses wait for explicit recovery; unanswered reconciles are reissued | pass | `execution.test.ts` "a lost launch response without identity…", "a reconcile attempt the Supervisor claims but never answers…" |
| Required targets never fall back | pass | `machine-scheduling.test.ts` "reference checks…" (disabled required target waits), "the launch request…" (`localFallback: false`) |
| Remote reconnect/disconnect handling | retired | Harness-owned under the amendment. |

## 7. Compatibility failures

| Check | Result | Evidence |
| --- | --- | --- |
| A Supervisor that can launch nothing leaves remotes and local waiting with a visible `incompatible` reason | pass | `execution.test.ts` "remotes wait while the Supervisor can launch nothing", "capability registration wakes the queue…" |
| Disabled, missing and remapped targets have visible reasons | pass | `execution.test.ts` "a changed mapping under an occupied slug…" (`unmapped`); `story-placement.test.ts` (`missing-target`); `machine-scheduling.test.ts` (`disabled`) |
| Tool/version, beta, link, access and preparation preflight | retired | 2026-10-31 amendment: sf runs no remote preflight. |

## 8. Coverage and docs

| Check | Result | Evidence |
| --- | --- | --- |
| Focused scheduler/service/CLI/HTTP coverage | pass | the files above; `pnpm test` |
| Editor/status UI verified | pass (observed) | Manual run above. Validation adds the screenshots. |
| Setup, capacity, fallback, overrides and recovery docs | pass | [README](../../README.md#machine-scheduling), [core spec](../specs/01-core-function.md#remote-machines-and-scheduling-dev-9101112-separated-in-dev-31), [remote Workers](../remote-workers.md), `skills/sf/references/commands.md` |
| Fake adapters certify compatibility | not claimed | No real remote environment was used. A machine request is not evidence of remote execution. |
