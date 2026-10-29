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
};

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
  key: string;
  name: string;
  stages: StageConfig[];
  schema: FieldDef[];
  overrides: BoardOverrides;
};
