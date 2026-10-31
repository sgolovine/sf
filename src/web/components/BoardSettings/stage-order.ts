import { FIXED_STAGES } from "./fixed.ts";

/** Resolve a completed drop to the API's full-list index; cancelled/no-op drops never save. */
export function stageReorderIndex(stages: readonly { id: string }[], activeId: string, overId: string | null) {
  if (!overId || activeId === overId || FIXED_STAGES.has(activeId) || FIXED_STAGES.has(overId)) return null;
  const source = stages.findIndex((stage) => stage.id === activeId);
  const destination = stages.findIndex((stage) => stage.id === overId);
  if (source < 1 || source > stages.length - 2 || destination < 1 || destination > stages.length - 2) return null;
  return destination;
}
