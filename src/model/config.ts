import type { ModelOption } from "./models.ts";
export type FieldType = "text" | "number" | "single-select" | "multi-select" | "boolean" | "date";
export const FIELD_TYPES: readonly FieldType[] = ["text", "number", "single-select", "multi-select", "boolean", "date"];

/** A custom field in a Board's Story schema. `options` is for the select types. */
export type FieldDef = { id: string; name: string; type: FieldType; options?: string[] };

export type StageConfig = {
  /** Stable slug id; never changes on rename. */
  id: string;
  name: string;
  promptEnabled: boolean;
  agent?: string | null;
  model?: string | null;
  /** HIL fields: while the boolean `flag` field is true on a Story in this Stage, no Worker runs on it. */
  hil?: StageHil;
};

/** Field ids from the Board schema: `flag` a boolean field, `comment` an optional text field. */
export type StageHil = { flag: string; comment?: string };

export type WorkerSettings = { agent: string | null; model: string | null };

/**
 * A remote machine in the Project's catalog. sf only names it to the Supervisor's harness, which owns
 * discovery, preparation and launch there. `capacity` omitted inherits the Project's `maxConcurrentWorkers`.
 */
export type RemoteMachine = { id: string; name: string; enabled: boolean; capacity?: number };

/** Per-machine scheduling: local capacity and the machine order, by catalog ID. */
export type SchedulingConfig = {
  local: { capacity: number };
  order: string[];
};

/** `.sf/sf.config.json`. */
export type ProjectConfig = {
  version: 1;
  /** The remote machine catalog, independent of `scheduling`. */
  remoteMachines?: RemoteMachine[];
  scheduling?: SchedulingConfig;
  modelOptions?: ModelOption[];
  worker: WorkerSettings;
  worktree: { baseBranch: string | null };
  claimTimeoutMinutes: number;
  briefPreamble: string;
  /**
   * Project-wide; cannot be overridden per Board. Local capacity without `scheduling`, and the default
   * capacity of each remote machine without its own.
   */
  maxConcurrentWorkers: number;
};

export type BoardOverrides = {
  worker?: Partial<WorkerSettings>;
  worktree?: { baseBranch?: string | null };
  claimTimeoutMinutes?: number;
  briefPreamble?: string;
};

/** `.sf/boards/<id>/board.config.json`. */
export type BoardConfig = {
  /** Highest allocated Story number; committed so deleted Keys are never reused. */
  storyNumber?: number;
  key: string;
  modelOptions?: ModelOption[];
  name: string;
  stages: StageConfig[];
  schema: FieldDef[];
  overrides: BoardOverrides;
};

/** The Story's HIL when the HIL flag of the Stage it is in is true, else null. */
export function activeHil(
  board: BoardConfig,
  story: { stage: string; fields: Record<string, unknown> },
): { flag: string; comment?: string } | null {
  const hil = board.stages.find((s) => s.id === story.stage)?.hil;
  if (!hil || story.fields[hil.flag] !== true) return null;
  const comment = hil.comment ? story.fields[hil.comment] : undefined;
  return { flag: hil.flag, ...(typeof comment === "string" && comment.trim() ? { comment } : {}) };
}
