# Remote execution requires verified adapters and authoritative Worker commands

Date: 2026-10-29. Status: accepted boundary; revised 2026-10-31 (DEV-11): the harness owns
machine handling, and the sf-owned remote adapter and transport gates are superseded.

## Revision (2026-10-31, DEV-11)

The user revised DEV-11: "let the actual machine handling happen on the T3/Harness side. For the
sf integration, when a user selects 'Use X Machine', it should just append additional instructions
to the request so the underlying harness knows to start on a different machine."

- sf keeps placement policy, reservations, Claims and Story authority (DEV-9/10, ADR 0001/0002).
- When placement selects a configured remote, sf adds a `machine` request to `worker.spawn` and
  appends delimited machine instructions to the Worker Brief. They give the machine's name and
  stable IDs, required/preferred intent and whether local fallback is allowed.
- The Supervisor's harness owns discovery, launch on that machine, machine preparation and the
  remote Worker's access to sf's Story commands. sf adds no remote launch, status or cancel
  adapter, worktree transfer, network transport or credentials, and invents no launch-tool
  parameters.
- A configured, enabled remote is eligible whenever the Supervisor can launch Workers. A machine
  request is not evidence of remote execution; results use the existing reporting.

The 2026-10-29 sections below are kept as the original decision. Where they require a verified
sf-owned adapter, a Worker/Claim-scoped transport, or a real-target test before remote dispatch,
this revision replaces them. See [the current boundary](../remote-workers.md#current-boundary-dev-11-2026-10-31).

## Context

Workers currently execute in local Story Worktrees and call sf against the Supervisor's checkout.
[ADR 0001](0001-story-writes-through-sf.md) establishes that checkout as the Story authority.
[ADR 0002](0002-cli-first-foreground-server.md) ties sf's foreground server to its Supervisor.
Neither permits treating a remote clone or loopback address as the authoritative Project.

The [DEV-7 compatibility report](../remote-workers.md) records the installed public contracts:
T3 Code thinkpad, environment `729b1264-b961-4247-b425-94a8bb98c273`, version `0.1.2`,
checked 2026-10-29. Local orchestration is declared; linked-target discovery and remote
selection are not. Upstream remote documentation is not evidence of installed support.
Minimum compatible release and remote command transport remain unverified.

## Decision

Keep policy and authority in sf; isolate T3 specifics at the Supervisor/adapter boundary.
sf selects placement and durably reserves a machine, Story branch and stable launch identity
under its mutation lock before dispatch. Network preparation/launch/status/cancel happens outside
that lock. The adapter supplies eligibility evidence, owning environment/project/worktree/head,
external identities and verified status/termination. Reconcile uncertain launches after restart
before retry; retain occupied/unknown capacity and branch exclusion until uncertainty is resolved.

Claim invalidation revokes Story command authority independently of external execution.
Move/release/force-release/timeout cannot be treated as proof of termination. Local expiry used to
delete the Claim and free its counted slot without stopping the Worker; DEV-10 changed that (see
the [execution ledger](../execution-ledger.md)). The next Stage cannot reuse a branch still occupied by external work.

Remote Workers must use a Worker/Claim-scoped authenticated channel into the authoritative sf
Story service for read/update/create/move/release and Claim refresh. Preserve HIL, complete briefs
and resource semantics; reject stale Claims; never give the broad UI token to a remote Worker.
There is no remote offline write fallback or second authoritative `.sf`.

*(Superseded 2026-10-31: the harness gives remote Workers access to sf's Story commands.)*
**Do not select a runnable remote transport yet.** Direct authenticated CLI transport is the
preferred candidate but requires a verified reachable route, scoped credentials, authoritative
schema reads, retry receipts and fail-closed CLI mode. Existing CLI discovery, loopback API and
local offline fallback do not provide it. Supervisor-mediated RPC requires a public authenticated,
correlated request/result contract, not narrative messages or final task summaries.
The report specifies the exact missing prerequisites. Resolving them is a DEV-11 gate;
until then remote dispatch is unavailable and existing local dispatch continues.

Use public API/schema checks and a real configured target test to establish compatibility;
never infer it from version numbering, app name, local spawn flags or accepted unknown keys.
Reuse established T3 links; store no pairing credentials in committed sf configuration.

## Consequences

- DEV-9 owns configuration/selector and legacy cap precedence; DEV-10 owns durable reservations
  and lifecycle recovery; DEV-11 (revised 2026-10-31) passes the selected machine to the harness;
  DEV-12 owns controls/status and the complete feature verification. Follow this sequence.
- Capacity is per sf Project across Boards with one environment per machine. Multiple routes
  share its capacity; independent environments on one host and host-wide cross-Project quotas
  need separate future design. Per-machine caps replace the legacy total when configured.
- Unsupported preflight is a valid DEV-7 result; it cannot certify DEV-11/12 remote lifecycle.
  Required targets never silently fall back. Uncertain launches cannot be retried elsewhere.
- No runtime behavior changes in this ADR. See the report for evidence, unavailable reasons,
  command-channel requirements, recovery and the explicitly unrun real-target test checklist.

## Considered options

- Forward local absolute paths/loopback or edit a remote `.sf`: rejected; violates authority.
- Expose the existing broad-token API to Workers: rejected; lacks Worker/Claim-scoped authorization.
- Use prose messages as RPC: rejected without identity, correlation, replay and recovery proof.
- Assume upstream remote APIs exist in this build: rejected by the installed declarations.
- Implement a transport now despite missing prerequisites: deferred; verify the missing contracts
  during DEV-11 refinement before choosing direct CLI or supported mediated RPC.
