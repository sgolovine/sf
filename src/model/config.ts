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

/** `.sf/sf.config.json`. */
export type ProjectConfig = {
  version: 1;
  worker: WorkerSettings;
  worktree: { baseBranch: string | null };
  claimTimeoutMinutes: number;
  briefPreamble: string;
  /** Project-wide; cannot be overridden per Board. */
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
