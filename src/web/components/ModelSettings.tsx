import { useState } from "react";
import type { BoardConfig, ProjectConfig } from "#model/config";
import { modelCatalog, resolveModel } from "#model/models";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sfApi } from "../api/client.ts";
import type { Act } from "./ErrorBanner.tsx";
import { ModelSelector } from "./ModelSelector.tsx";

/** Project and Board defaults share the same catalog editor, with separate persisted catalogs. */
export function ModelSettings({
  project,
  board,
  boardId,
  act,
}: {
  project: ProjectConfig;
  board?: BoardConfig;
  boardId?: string;
  act: Act;
}) {
  const [model, setModel] = useState((board ? board.overrides.worker?.model : project.worker.model) ?? "");
  const [options, setOptions] = useState((board ? board.modelOptions : project.modelOptions) ?? []);
  const [slug, setSlug] = useState("");
  const [label, setLabel] = useState("");
  const draftProject = board ? project : { ...project, worker: { ...project.worker, model }, modelOptions: options };
  const draftBoard = board
    ? {
        ...board,
        overrides: { ...board.overrides, worker: { ...board.overrides.worker, model } },
        modelOptions: options,
      }
    : undefined;
  return (
    <form
      className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        void act(() =>
          boardId
            ? sfApi.updateBoard(boardId, { model: model || null, modelOptions: options })
            : sfApi.updateProject({ model: model || null, modelOptions: options }),
        );
      }}
    >
      <h2 className="text-lg font-semibold">{board ? "Board Worker settings" : "Project settings"}</h2>
      <ModelSelector
        value={model}
        onChange={setModel}
        options={modelCatalog(draftProject, draftBoard)}
        effective={resolveModel(draftProject, draftBoard)}
        defaultLabel={board ? "Inherit from Project" : "Supervisor default"}
      />
      <fieldset className="grid gap-3 rounded-md border p-4">
        <legend className="px-1 text-sm font-medium">Custom models for this {board ? "Board" : "Project"}</legend>
        <Input
          aria-label="Custom model slug"
          placeholder="Model slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
        <Input
          aria-label="Custom model label"
          placeholder="Display label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          disabled={!slug || slug !== slug.trim() || /\s/.test(slug)}
          onClick={() => {
            setOptions([...options.filter((o) => o.slug !== slug), { slug, label: label || slug }]);
            setSlug("");
            setLabel("");
          }}
        >
          Add model option
        </Button>
        {options.map((o) => (
          <p className="text-sm" key={o.slug}>
            {o.label} · {o.slug}
          </p>
        ))}
        <p className="text-sm text-muted-foreground">
          Adding an option does not select it. Save to persist these choices. Built-in model labels stay unchanged.
        </p>
      </fieldset>
      <Button type="submit">Save settings</Button>
    </form>
  );
}
