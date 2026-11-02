import { SfError } from "../server/project/errors.ts";
import type { ProjectConfig, RemoteMachine, SchedulingConfig } from "./config.ts";

export type StoryPlacement =
  | { mode: "inherit" }
  | { mode: "local-only" }
  | { mode: "required" | "preferred"; machineId: string };

function invalid(field: string, correction: string): never {
  throw new SfError("invalid", `${field}: ${correction}`);
}

function object(value: unknown, field: string, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(
      field,
      field === "placement"
        ? "must be a placement object; rename any legacy custom field named placement and its Story data"
        : "must be an object",
    );
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record))
    if (!keys.includes(key)) invalid(`${field}.${key}`, "unsupported field; remove it");
  return record;
}

function text(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !value || value.trim() !== value)
    invalid(field, "must be nonblank text without surrounding whitespace");
}

export function validateCapacity(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    invalid(field, "must be a finite nonnegative safe integer");
}

/** The remote machine catalog: unique slugs (never `local`), nonblank labels and optional capacity overrides. */
export function validateRemoteMachines(value: unknown, field = "remoteMachines"): asserts value is RemoteMachine[] {
  if (!Array.isArray(value)) invalid(field, "must be an array of remote machines; use [] for none");
  const ids = new Set(["local"]);
  for (const [index, entry] of value.entries()) {
    const at = `${field}[${index}]`;
    const remote = object(entry, at, ["id", "name", "enabled", "capacity"]);
    if (typeof remote.id !== "string" || !/^[a-z][a-z0-9_-]*$/.test(remote.id))
      invalid(`${at}.id`, "use a lowercase slug beginning with a letter");
    if (ids.has(remote.id))
      invalid(`${at}.id`, `duplicate or reserved ID "${remote.id}"; choose a unique machine slug other than local`);
    ids.add(remote.id);
    text(remote.name, `${at}.name`);
    if (typeof remote.enabled !== "boolean") invalid(`${at}.enabled`, "must be a boolean");
    if (remote.capacity !== undefined) validateCapacity(remote.capacity, `${at}.capacity`);
  }
}

/** Validate policy data against the catalog it orders, without inferring remote support. */
export function validateScheduling(
  value: unknown,
  remotes: readonly RemoteMachine[] = [],
): asserts value is SchedulingConfig {
  if (value && typeof value === "object" && Object.hasOwn(value, "remotes"))
    invalid("scheduling.remotes", "remote machines moved to remoteMachines; keep only local and order in scheduling");
  const config = object(value, "scheduling", ["local", "order"]);
  const local = object(config.local, "scheduling.local", ["capacity"]);
  validateCapacity(local.capacity, "scheduling.local.capacity");
  const ids = new Set(["local", ...remotes.map((r) => r.id)]);
  if (!Array.isArray(config.order)) invalid("scheduling.order", "must be an array of machine IDs; use [] to wait");
  const seen = new Set<string>();
  for (const id of config.order) {
    if (typeof id !== "string" || !ids.has(id))
      invalid("scheduling.order", `unknown machine ID "${String(id)}"; add it to remoteMachines first`);
    if (seen.has(id)) invalid("scheduling.order", `duplicate machine ID "${id}"; list each machine once`);
    seen.add(id);
  }
}

/**
 * The validated catalog and scheduling of a stored Project config. A legacy `scheduling.remotes` (DEV-9)
 * is promoted to the catalog in memory, dropping its environment/project/repository mapping; the next
 * settings save writes the canonical shape. Both catalogs at once is a conflict, never a silent choice.
 */
export function readMachines(raw: { remoteMachines?: unknown; scheduling?: unknown }): {
  remoteMachines?: RemoteMachine[];
  scheduling?: SchedulingConfig;
} {
  let catalog = raw.remoteMachines;
  let scheduling = raw.scheduling;
  let field = "remoteMachines";
  if (
    scheduling &&
    typeof scheduling === "object" &&
    !Array.isArray(scheduling) &&
    Object.hasOwn(scheduling, "remotes")
  ) {
    if (Object.hasOwn(raw, "remoteMachines"))
      invalid(
        "scheduling.remotes",
        "conflicts with remoteMachines; move each legacy remote into remoteMachines (id, name, enabled, capacity) and delete scheduling.remotes",
      );
    const { remotes, ...rest } = scheduling as Record<string, unknown>;
    field = "scheduling.remotes";
    if (!Array.isArray(remotes)) invalid(field, "must be an array");
    catalog = remotes.map((entry, index) => {
      const legacy = object(entry, `${field}[${index}]`, [
        "id",
        "name",
        "environmentId",
        "project",
        "enabled",
        "capacity",
      ]);
      const { environmentId: _environment, project: _project, ...kept } = legacy;
      return kept;
    });
    scheduling = rest;
  }
  if (catalog !== undefined) validateRemoteMachines(catalog, field);
  if (scheduling !== undefined) validateScheduling(scheduling, catalog ?? []);
  return {
    ...(catalog !== undefined ? { remoteMachines: catalog } : {}),
    ...(scheduling !== undefined ? { scheduling } : {}),
  };
}

/** Parse structure separately so stale persisted targets can still be edited or cleared. */
export function parsePlacement(value: unknown): StoryPlacement | undefined {
  if (value === undefined || value === null) return undefined;
  const placement = object(value, "placement", ["mode", "machineId"]);
  if (placement.mode === "inherit" || placement.mode === "local-only") {
    if (Object.hasOwn(placement, "machineId"))
      invalid("placement.machineId", "remove the target for inherit/local-only");
    return placement.mode === "inherit" ? undefined : { mode: "local-only" };
  }
  if (placement.mode !== "required" && placement.mode !== "preferred")
    invalid(
      "placement.mode",
      "use inherit, local-only, required or preferred; rename any legacy custom field named placement and its data",
    );
  text(placement.machineId, "placement.machineId");
  return { mode: placement.mode, machineId: placement.machineId };
}

export function validatePlacement(value: unknown, remotes: readonly RemoteMachine[] = []): StoryPlacement | undefined {
  const placement = parsePlacement(value);
  if (placement && "machineId" in placement && !remotes.some((r) => r.id === placement.machineId))
    invalid(
      "placement.machineId",
      `unknown remote "${placement.machineId}"; add it to remoteMachines or clear placement`,
    );
  return placement;
}

export type PlacementPolicy = { machines: Record<string, { capacity: number; enabled: boolean }>; order: string[] };

type MachineConfig = Pick<ProjectConfig, "scheduling" | "remoteMachines" | "maxConcurrentWorkers">;

/**
 * Every configured machine with its effective capacity, and the order inherited placement uses.
 * `maxConcurrentWorkers` is local capacity without scheduling and each remote's default capacity; it is
 * never a cap across machines. Without scheduling the order is local only: remotes are used only when a
 * Story's placement names them.
 */
export function normalizePlacementPolicy(config: MachineConfig): PlacementPolicy {
  const max = config.maxConcurrentWorkers ?? 3;
  validateCapacity(max, "maxConcurrentWorkers");
  const remotes = config.remoteMachines ?? [];
  validateRemoteMachines(remotes);
  if (config.scheduling !== undefined) validateScheduling(config.scheduling, remotes);
  return {
    machines: Object.fromEntries([
      ["local", { capacity: config.scheduling?.local.capacity ?? max, enabled: true }],
      ...remotes.map((r) => [r.id, { capacity: r.capacity ?? max, enabled: r.enabled }]),
    ]),
    order: config.scheduling ? [...config.scheduling.order] : ["local"],
  };
}

export type MachineUsage = { id: string; used: number; capacity: number | null; enabled: boolean; configured: boolean };

/**
 * Used/max per machine from occupying executions. `used` may exceed a lowered cap; machines that only
 * hold leftover occupancy (removed by hand) are listed with capacity null.
 */
export function machineUsage(
  config: MachineConfig,
  executions: Iterable<{ machineId: string; status: string }>,
): MachineUsage[] {
  const policy = normalizePlacementPolicy(config);
  const used: Record<string, number> = {};
  for (const e of executions) if (e.status !== "terminal") used[e.machineId] = (used[e.machineId] ?? 0) + 1;
  const ids = [...new Set([...Object.keys(policy.machines), ...Object.keys(used)])];
  return ids.map((id) => {
    const machine = Object.hasOwn(policy.machines, id) ? policy.machines[id] : undefined;
    return {
      id,
      used: used[id] ?? 0,
      capacity: machine?.capacity ?? null,
      enabled: machine?.enabled ?? false,
      configured: !!machine,
    };
  });
}

export const ELIGIBILITY_REASONS = [
  "missing-target",
  "disabled",
  "incompatible",
  "unreachable",
  "unauthorized",
  "unmapped",
  "agent-ineligible",
  "model-ineligible",
] as const;
export type EligibilityReason = (typeof ELIGIBILITY_REASONS)[number];
/** Explicit evidence for the resolved Stage agent/model; multiple failures use the declared priority. */
export type TargetEligibility = { failures: readonly EligibilityReason[]; detail?: string };
export type PlacementReason = {
  machineId?: string;
  code: EligibilityReason | "capacity" | "no-candidates";
  detail?: string;
};
export type PlacementResult = { kind: "selected"; machineId: string } | { kind: "wait"; reasons: PlacementReason[] };

/** Pure first-fit selection: never reserves, mutates usage, discovers targets or launches work. */
export function selectPlacement(
  policy: PlacementPolicy,
  placement: StoryPlacement | undefined,
  eligibility: Readonly<Record<string, TargetEligibility | undefined>>,
  usage: Readonly<Record<string, number>>,
): PlacementResult {
  for (const [id, count] of Object.entries(usage)) validateCapacity(count, `usage.${id}`);
  const mode = placement?.mode ?? "inherit";
  const target = placement && "machineId" in placement ? placement.machineId : "";
  const candidates = [
    ...new Set(
      mode === "local-only"
        ? ["local"]
        : mode === "required"
          ? [target]
          : mode === "preferred"
            ? [target, ...policy.order]
            : policy.order,
    ),
  ];
  const reasons: PlacementReason[] = [];
  for (const machineId of candidates) {
    const machine = Object.hasOwn(policy.machines, machineId) ? policy.machines[machineId] : undefined;
    const evidence = Object.hasOwn(eligibility, machineId) ? eligibility[machineId] : undefined;
    const failures = new Set(evidence?.failures);
    if (!machine) failures.add("missing-target");
    else if (!machine.enabled) failures.add("disabled");
    if (!evidence) failures.add("incompatible");
    const code = ELIGIBILITY_REASONS.find((code) => failures.has(code));
    if (code)
      reasons.push({
        machineId,
        code,
        ...(!evidence && code === "incompatible"
          ? { detail: "Target eligibility is unverified; supply explicit evidence, including for local" }
          : evidence?.detail
            ? { detail: evidence.detail }
            : {}),
      });
    else if ((Object.hasOwn(usage, machineId) ? usage[machineId]! : 0) >= machine!.capacity)
      reasons.push({ machineId, code: "capacity" });
    else return { kind: "selected", machineId };
  }
  return { kind: "wait", reasons: reasons.length ? reasons : [{ code: "no-candidates" }] };
}
