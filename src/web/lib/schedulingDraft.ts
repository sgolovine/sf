import type { SchedulingConfig } from "#model/config";

type Remote = SchedulingConfig["remotes"][number];

/**
 * A remote row in the scheduling form. Capacities are edited as text; the server validates them on save.
 * `key` stays fixed while the row's machine ID is edited, so the order can follow a rename.
 */
export type RemoteDraft = Omit<Remote, "capacity"> & { key: string; capacity: string };

/** The order's slot for the Supervisor's machine. Remote keys start with `#`, which a machine ID cannot. */
export const LOCAL_SLOT = "local";

/** Form state: `order` holds `LOCAL_SLOT` and remote draft keys, not machine IDs. */
export type SchedulingDraft = { remotes: RemoteDraft[]; order: string[] };

export function draftScheduling(current: SchedulingConfig | undefined): SchedulingDraft {
  const remotes = (current?.remotes ?? []).map((r, i) => ({ ...r, key: `#${i}`, capacity: String(r.capacity) }));
  const slotOf = (id: string) => (id === "local" ? LOCAL_SLOT : (remotes.find((r) => r.id === id)?.key ?? id));
  return { remotes, order: current?.order.map(slotOf) ?? [LOCAL_SLOT] };
}

export function blankRemote(remotes: RemoteDraft[]): RemoteDraft {
  const next = Math.max(-1, ...remotes.map((r) => Number(r.key.slice(1)))) + 1;
  return {
    key: `#${next}`,
    id: "",
    name: "",
    environmentId: "",
    project: { projectId: "", repository: "" },
    enabled: true,
    capacity: "1",
  };
}

/** The machine ID an order slot stands for; unmatched slots are passed through for the server to reject. */
export function slotId(slot: string, remotes: RemoteDraft[]): string {
  return slot === LOCAL_SLOT ? "local" : (remotes.find((r) => r.key === slot)?.id ?? slot);
}

/** Blank text becomes NaN, so the server reports the field instead of reading it as 0. */
export const toNumber = (text: string) => (text.trim() === "" ? Number.NaN : Number(text));

export function toScheduling(local: string, draft: SchedulingDraft): SchedulingConfig {
  return {
    local: { capacity: toNumber(local) },
    remotes: draft.remotes.map(({ key: _, ...r }) => ({ ...r, capacity: toNumber(r.capacity) })),
    order: draft.order.map((slot) => slotId(slot, draft.remotes)),
  };
}
