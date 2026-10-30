import type { BoardConfig, ProjectConfig, StageConfig } from "./config.ts";

export type ModelOption = { slug: string; label: string };
export type ResolvedModel = { model: string | null; source: "story" | "stage" | "board" | "project" | "supervisor" };

export const MODEL_PRESETS: readonly ModelOption[] = [
  { label: "GPT 6.1 Sol", slug: "gpt-6.1-sol" },
  { label: "Opus 5.5", slug: "claude-opus-5-5" },
  { label: "Fable 5.1", slug: "claude-fable-5-1" },
  { label: "Haiku 5.5", slug: "claude-haiku-5-5" },
  { label: "GPT 6 Luna", slug: "gpt-6-luna" },
  { label: "GPT 6.1 Terra", slug: "gpt-6.1-terra" },
  { label: "GPT 6 Astra", slug: "gpt-6-astra" },
];

/** Closest explicit selection wins; empty selections inherit. Agent selection is independent. */
export function resolveModel(
  project: ProjectConfig,
  board?: BoardConfig,
  stage?: StageConfig,
  story?: { model?: string | null },
): ResolvedModel {
  const selections = [
    ["story", story?.model],
    ["stage", stage?.model],
    ["board", board?.overrides.worker?.model],
    ["project", project.worker.model],
  ] as const;
  for (const [source, model] of selections) if (typeof model === "string" && model) return { model, source };
  return { model: null, source: "supervisor" };
}

/** Board labels override Project custom labels; built-in labels are immutable. */
export function modelCatalog(
  project: ProjectConfig,
  board?: BoardConfig,
  selections: (string | null | undefined)[] = [],
): ModelOption[] {
  const options = new Map<string, ModelOption>();
  for (const option of [...(project.modelOptions ?? []), ...(board?.modelOptions ?? []), ...MODEL_PRESETS])
    options.set(option.slug, option);
  for (const slug of [
    project.worker.model,
    board?.overrides.worker?.model,
    ...(board?.stages.map((s) => s.model) ?? []),
    ...selections,
  ])
    if (slug && !options.has(slug)) options.set(slug, { slug, label: slug });
  return [...MODEL_PRESETS, ...[...options.values()].filter((o) => !MODEL_PRESETS.some((p) => p.slug === o.slug))];
}

export function modelDescription(value: ResolvedModel): string {
  return value.model ? `${value.model} (from ${value.source})` : "Supervisor default";
}
