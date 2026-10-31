import { SfError } from "../server/project/errors.ts";
import type { ProjectConfig, SchedulingConfig } from "./config.ts";

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

function identity(value: unknown, field: string) {
  text(value, field);
  if (/[\\/\s]/.test(value) || /^[a-z]:/i.test(value) || [".", "..", "~"].includes(value) || value.includes("://"))
    invalid(field, "use the canonical opaque ID, not a URL or filesystem path");
}

export function validateCapacity(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    invalid(field, "must be a finite nonnegative safe integer");
}

/** Validate policy data without inferring remote support or normalizing identities. */
export function validateScheduling(value: unknown): asserts value is SchedulingConfig {
  const config = object(value, "scheduling", ["local", "remotes", "order"]);
  const local = object(config.local, "scheduling.local", ["capacity"]);
  validateCapacity(local.capacity, "scheduling.local.capacity");
  if (!Array.isArray(config.remotes)) invalid("scheduling.remotes", "must be an array");
  const ids = new Set(["local"]);
  const environments = new Set<string>();
  for (const [index, value] of config.remotes.entries()) {
    const field = `scheduling.remotes[${index}]`;
    const remote = object(value, field, ["id", "name", "environmentId", "project", "enabled", "capacity"]);
    if (typeof remote.id !== "string" || !/^[a-z][a-z0-9_-]*$/.test(remote.id))
      invalid(`${field}.id`, "use a lowercase slug beginning with a letter");
    if (ids.has(remote.id))
      invalid(`${field}.id`, `duplicate or reserved ID "${remote.id}"; choose a unique remote ID other than local`);
    ids.add(remote.id);
    text(remote.name, `${field}.name`);
    identity(remote.environmentId, `${field}.environmentId`);
    if (environments.has(remote.environmentId as string))
      invalid(
        `${field}.environmentId`,
        "duplicate environment alias; configure each environment once, even when disabled",
      );
    environments.add(remote.environmentId as string);
    const project = object(remote.project, `${field}.project`, ["projectId", "repository"]);
    identity(project.projectId, `${field}.project.projectId`);
    text(project.repository, `${field}.project.repository`);
    const parts = project.repository.split("/");
    if (
      parts.length < 2 ||
      !parts[0]!.split(".").every((label) => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label)) ||
      parts.some((part) => !part || part === "." || part === "..") ||
      /[\s\\:@?#]/.test(project.repository)
    )
      invalid(
        `${field}.project.repository`,
        "use the exact catalog repositoryIdentity.canonicalKey (host/repository/path), not a clone URL or checkout path",
      );
    if (typeof remote.enabled !== "boolean") invalid(`${field}.enabled`, "must be a boolean");
    validateCapacity(remote.capacity, `${field}.capacity`);
  }
  if (!Array.isArray(config.order)) invalid("scheduling.order", "must be an array of machine IDs; use [] to wait");
  const seen = new Set<string>();
  for (const id of config.order) {
    if (typeof id !== "string" || !ids.has(id))
      invalid("scheduling.order", `unknown machine ID "${String(id)}"; configure it first`);
    if (seen.has(id)) invalid("scheduling.order", `duplicate machine ID "${id}"; list each machine once`);
    seen.add(id);
  }
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

export function validatePlacement(value: unknown, scheduling?: SchedulingConfig): StoryPlacement | undefined {
  const placement = parsePlacement(value);
  if (placement && "machineId" in placement && !scheduling?.remotes.some((r) => r.id === placement.machineId))
    invalid("placement.machineId", `unknown remote "${placement.machineId}"; configure it or clear placement`);
  return placement;
}

export type PlacementPolicy = { machines: Record<string, { capacity: number; enabled: boolean }>; order: string[] };

/** Scheduling replaces the legacy total only for consumers of this policy. Dispatch activation is deferred. */
export function normalizePlacementPolicy(
  config: Pick<ProjectConfig, "scheduling" | "maxConcurrentWorkers">,
): PlacementPolicy {
  if (config.scheduling === undefined) {
    const capacity = config.maxConcurrentWorkers ?? 3;
    validateCapacity(capacity, "maxConcurrentWorkers");
    return { machines: { local: { capacity, enabled: true } }, order: ["local"] };
  }
  validateScheduling(config.scheduling);
  return {
    machines: Object.fromEntries([
      ["local", { capacity: config.scheduling.local.capacity, enabled: true }],
      ...config.scheduling.remotes.map((r) => [r.id, { capacity: r.capacity, enabled: r.enabled }]),
    ]),
    order: [...config.scheduling.order],
  };
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
