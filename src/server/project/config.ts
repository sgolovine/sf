import fs from "node:fs";
import path from "node:path";
import {
  type BoardConfig,
  type BoardOverrides,
  FIELD_TYPES,
  type FieldDef,
  type ProjectConfig,
  type StageConfig,
} from "#model/config";
import { type ModelOption, resolveModel } from "#model/models";
import { SfError } from "./errors.ts";
import { readJson, writeJson } from "./fsutil.ts";
import { sfPaths } from "./paths.ts";
import { readStage } from "./stage.ts";

export const BACKLOG = "backlog";
export const DONE = "done";

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  version: 1,
  worker: { agent: null, model: null },
  worktree: { baseBranch: null },
  claimTimeoutMinutes: 120,
  briefPreamble: "",
  maxConcurrentWorkers: 3,
};

export function loadProjectConfig(root: string): ProjectConfig {
  const raw = readJson<Partial<ProjectConfig>>(sfPaths(root).config);
  if (!raw) throw new SfError("no_project", `no sf Project at ${root} (run \`sf init\`)`);
  const d = DEFAULT_PROJECT_CONFIG;
  return {
    ...d,
    ...raw,
    version: 1,
    worker: { ...d.worker, ...raw.worker },
    worktree: { ...d.worktree, ...raw.worktree },
  };
}

/** Board ids, sorted. */
export function listBoardIds(root: string): string[] {
  const dir = sfPaths(root).boards;
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((id) => fs.existsSync(sfPaths(root).board(id)))
    .sort();
}

export function loadBoard(root: string, id: string): BoardConfig {
  const raw = readJson<Partial<BoardConfig>>(sfPaths(root).board(id));
  if (!raw) throw new SfError("not_found", `no Board ${id}`);
  const board: BoardConfig = {
    ...raw,
    key: String(raw.key ?? ""),
    name: String(raw.name ?? id),
    stages: raw.stages ?? [],
    schema: raw.schema ?? [],
    overrides: raw.overrides ?? {},
  };
  for (const stage of board.stages) {
    const { metadata } = readStage(path.join(sfPaths(root).stages(id), `${stage.id}.md`));
    if (Object.hasOwn(metadata, "model")) {
      validateModel(metadata.model);
      stage.model = typeof metadata.model === "string" && metadata.model ? metadata.model : null;
    }
  }
  return board;
}

export function saveBoard(root: string, id: string, board: BoardConfig) {
  validateBoard({ ...board, schema: board.schema.filter((f) => f.id !== "model") });
  const stored = {
    ...board,
    stages: board.stages.map((stage) => {
      const copy = { ...stage };
      // A migrated Stage's value lives only in Markdown.
      if (fs.existsSync(path.join(sfPaths(root).stages(id), `${stage.id}.md`))) {
        const { metadata } = readStage(path.join(sfPaths(root).stages(id), `${stage.id}.md`));
        if (Object.hasOwn(metadata, "model")) delete copy.model;
      }
      return copy;
    }),
  };
  writeJson(sfPaths(root).board(id), stored);
}

export function defaultBoard(name: string, key: string): BoardConfig {
  const stage = (id: string, stageName: string): StageConfig => ({ id, name: stageName, promptEnabled: false });
  return {
    key,
    name,
    stages: [
      stage(BACKLOG, "Backlog"),
      stage("todo", "TODO"),
      stage("in_progress", "In Progress"),
      stage("in_review", "In Review"),
      stage(DONE, "Done"),
    ],
    schema: [],
    overrides: {},
  };
}

export function isFixedStage(id: string) {
  return id === BACKLOG || id === DONE;
}

/** `In Review` → `in_review`. */
export function slug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function uniqueId(base: string, taken: Iterable<string>) {
  const used = new Set(taken);
  const id = base || "stage";
  if (!used.has(id)) return id;
  for (let n = 2; ; n++) if (!used.has(`${id}_${n}`)) return `${id}_${n}`;
}

export function validateBoard(board: BoardConfig) {
  if (board.storyNumber !== undefined && (!Number.isSafeInteger(board.storyNumber) || board.storyNumber < 0))
    invalid("Board storyNumber must be a nonnegative safe integer");
  if (!/^[A-Z][A-Z0-9]*$/.test(board.key))
    invalid(`Board key must be uppercase letters and digits, got "${board.key}"`);
  if (!board.name.trim()) invalid("Board name must not be empty");
  const ids = board.stages.map((s) => s.id);
  if (ids[0] !== BACKLOG || ids.at(-1) !== DONE) invalid("Backlog must be the first Stage and Done the last");
  if (new Set(ids).size !== ids.length) invalid("Stage ids must be unique");
  for (const s of board.stages) {
    if (!s.id || !s.name.trim()) invalid("every Stage needs an id and a name");
    if (isFixedStage(s.id) && s.promptEnabled) invalid(`${s.name} cannot have a Stage Prompt`);
  }
  validateModel(board.overrides.worker?.model);
  normalizeModelOptions(board.modelOptions);
  for (const stage of board.stages) validateModel(stage.model);
  validateSchema(board.schema);
  for (const s of board.stages) if (s.hil !== undefined) validateHil(board, s);
  validateOverrides(board.overrides);
}

export function validateSchema(schema: FieldDef[]) {
  if (!Array.isArray(schema)) invalid("schema must be an array");
  const seen = new Set<string>();
  for (const f of schema) {
    if (!f || typeof f.id !== "string" || !/^[a-z][a-z0-9_]*$/.test(f.id))
      invalid(`field id must be lowercase letters, digits, and _, got "${f?.id}"`);
    if (["title", "stage", "branch", "model", "dependsOn"].includes(f.id)) invalid(`"${f.id}" is a reserved field id`);
    if (seen.has(f.id)) invalid(`duplicate field id "${f.id}"`);
    seen.add(f.id);
    if (typeof f.name !== "string" || !f.name.trim()) invalid(`field ${f.id} needs a name`);
    if (!FIELD_TYPES.includes(f.type)) invalid(`field ${f.id} type must be one of ${FIELD_TYPES.join(", ")}`);
    if (f.type === "single-select" || f.type === "multi-select") {
      if (!Array.isArray(f.options) || !f.options.length || f.options.some((o) => typeof o !== "string" || !o))
        invalid(`field ${f.id} needs a list of options`);
    }
  }
}

function validateHil(board: BoardConfig, stage: StageConfig) {
  const { hil } = stage;
  if (isFixedStage(stage.id)) invalid(`${stage.name} cannot have HIL fields`);
  if (!hil || typeof hil !== "object" || typeof hil.flag !== "string" || !hil.flag)
    invalid(`Stage ${stage.id} HIL needs a flag field`);
  const type = (id: string) => board.schema.find((f) => f.id === id)?.type;
  if (type(hil.flag) !== "boolean") invalid(`HIL flag of Stage ${stage.id} must be a boolean field, got "${hil.flag}"`);
  if (hil.comment !== undefined && type(hil.comment) !== "text")
    invalid(`HIL comment of Stage ${stage.id} must be a text field, got "${hil.comment}"`);
}

export function validateOverrides(overrides: BoardOverrides) {
  if (!overrides || typeof overrides !== "object") invalid("overrides must be an object");
  if ("maxConcurrentWorkers" in overrides) invalid("maxConcurrentWorkers is Project-wide and cannot be set per Board");
  const t = overrides.claimTimeoutMinutes;
  if (t !== undefined && !(typeof t === "number" && t > 0)) invalid("claimTimeoutMinutes must be a positive number");
}

export type Settings = {
  agent: string | null;
  model: string | null;
  baseBranch: string | null;
  claimTimeoutMinutes: number;
  briefPreamble: string;
  maxConcurrentWorkers: number;
};

/** Stage over Board over Project for agent/model; Board over Project for the rest. */
export function resolveSettings(
  project: ProjectConfig,
  board?: BoardConfig,
  stage?: StageConfig,
  story?: { model?: string | null },
): Settings {
  const o = board?.overrides ?? {};
  const pick = <T>(...values: (T | null | undefined)[]) => values.find((v) => v !== undefined && v !== null) ?? null;
  return {
    agent: pick(stage?.agent, o.worker?.agent, project.worker.agent),
    model: resolveModel(project, board, stage, story).model,
    baseBranch: pick(o.worktree?.baseBranch, project.worktree.baseBranch),
    claimTimeoutMinutes: o.claimTimeoutMinutes ?? project.claimTimeoutMinutes,
    briefPreamble: o.briefPreamble ?? project.briefPreamble,
    maxConcurrentWorkers: project.maxConcurrentWorkers,
  };
}

function invalid(message: string): never {
  throw new SfError("invalid", message);
}

/** Selections may be cleared, but slugs are never silently rewritten. */
export function validateModel(value: unknown) {
  if (value === undefined || value === null || value === "") return;
  if (typeof value !== "string" || value !== value.trim() || /\s/.test(value))
    invalid("model slug must be a nonempty string without whitespace");
}

export function normalizeModelOptions(value: unknown): ModelOption[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) invalid("modelOptions must be an array");
  return value.map((entry) => {
    if (!entry || typeof entry.slug !== "string" || !entry.slug) invalid("model option needs a nonempty slug");
    validateModel(entry.slug);
    if (entry.label !== undefined && (typeof entry.label !== "string" || !entry.label.trim()))
      invalid("model option label must be nonempty text");
    return { slug: entry.slug, label: entry.label ?? entry.slug };
  });
}
