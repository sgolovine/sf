import type { RemoteMachine } from "#model/config";

/**
 * A row in the remote machine form. Capacity is edited as text: blank inherits the Project maximum.
 * `key` stays fixed while the row's slug is edited, and `saved` is the slug it was loaded with, so the
 * scheduling order can follow a rename.
 */
export type RemoteDraft = Omit<RemoteMachine, "capacity"> & { key: string; saved?: string; capacity: string };

export function draftRemotes(current: readonly RemoteMachine[] | undefined): RemoteDraft[] {
  return (current ?? []).map((r, i) => ({ ...r, key: `#${i}`, saved: r.id, capacity: String(r.capacity ?? "") }));
}

export function blankRemote(remotes: RemoteDraft[]): RemoteDraft {
  const next = Math.max(-1, ...remotes.map((r) => Number(r.key.slice(1)))) + 1;
  return { key: `#${next}`, id: "", name: "", enabled: true, capacity: "" };
}

/** Blank text becomes NaN, so the server reports the field instead of reading it as 0. */
export const toNumber = (text: string) => (text.trim() === "" ? Number.NaN : Number(text));

/** The catalog to save. A blank capacity is omitted, which restores inheritance. */
export function toRemoteMachines(drafts: RemoteDraft[]): RemoteMachine[] {
  return drafts.map(({ id, name, enabled, capacity }) => ({
    id,
    name,
    enabled,
    ...(capacity.trim() === "" ? {} : { capacity: toNumber(capacity) }),
  }));
}

/** The scheduling order after the catalog edit: renamed slugs keep their position, removed ones leave. */
export function followOrder(order: readonly string[], drafts: RemoteDraft[]): string[] {
  return order.flatMap((id) => {
    if (id === "local") return [id];
    const row = drafts.find((r) => r.saved === id);
    return row ? [row.id] : [];
  });
}
