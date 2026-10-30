import { type ReactNode, useId, useState } from "react";
import type { ProjectConfig } from "#model/config";
import { activeHil, type FieldDef } from "#model/config";
import { modelCatalog, resolveModel } from "#model/models";
import type { BoardSnapshot, StoryView } from "#model/project";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { sfApi } from "../api/client.ts";
import type { Act } from "./ErrorBanner.tsx";
import { Markdown } from "./Markdown.tsx";
import { ModelSelector } from "./ModelSelector.tsx";

type Props = { project: ProjectConfig; board: BoardSnapshot; story: StoryView | null; act: Act; onClose: () => void };

/** Radix Select items cannot have an empty value; this one stands for "no value". */
const NONE = "__none__";

/** Create or edit a Story. Custom field inputs follow the Board's Story schema. */
export function StoryEditor({ project, board, story, act, onClose }: Props) {
  const id = useId();
  const [title, setTitle] = useState(story?.title ?? "");
  const [stage, setStage] = useState(story?.stage ?? "backlog");
  const [model, setModel] = useState(story?.model ?? "");
  const legacyModel = board.config.schema.some((f) => f.id === "model");
  const [body, setBody] = useState(story?.body ?? "");
  // Open existing descriptions rendered; start empty ones ready to type.
  const [bodyTab, setBodyTab] = useState<"write" | "preview">(story?.body.trim() ? "preview" : "write");
  const [fields, setFields] = useState<Record<string, unknown>>(story?.fields ?? {});
  const schema = board.config.schema.filter((f) => f.id !== "model");
  const hil = story && activeHil(board.config, story);

  const save = async () => {
    // Send every schema field; null clears it on the server.
    const values = Object.fromEntries(schema.map((f) => [f.id, fields[f.id] ?? null]));
    const ok = story
      ? await act(() =>
          sfApi.updateStory(story.key, {
            title,
            body,
            fields: values,
            ...(!legacyModel ? { model: model || null } : {}),
          }),
        )
      : await act(() =>
          sfApi.createStory({
            board: board.id,
            title,
            stage,
            body,
            fields: values,
            ...(!legacyModel ? { model: model || null } : {}),
          }),
        );
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>{story ? story.key : `New Story on ${board.config.name}`}</DialogTitle>
            <DialogDescription>
              {story
                ? `Stage: ${board.config.stages.find((s) => s.id === story.stage)?.name ?? story.stage}${story.branch ? ` · branch ${story.branch}` : ""}`
                : "Describe the work; custom fields follow the Board's settings."}
            </DialogDescription>
          </DialogHeader>
          {hil && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p className="font-semibold">Needs a human</p>
              {hil.comment && <p className="whitespace-pre-wrap">{hil.comment}</p>}
              <p className="mt-1 text-xs">
                No Worker runs while {schema.find((f) => f.id === hil.flag)?.name ?? hil.flag} is checked. Uncheck it
                and save to start one.
              </p>
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor={`${id}-title`}>Title</Label>
            <Input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          {!story && (
            <div className="grid gap-2">
              <Label htmlFor={`${id}-stage`}>Stage</Label>
              <Select value={stage} onValueChange={setStage}>
                <SelectTrigger id={`${id}-stage`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {board.config.stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {legacyModel && (
            <p role="alert">
              Legacy custom field “model” conflicts with the built-in model. Rename the field and its data before
              selecting a Worker model.
            </p>
          )}
          <ModelSelector
            disabled={legacyModel}
            value={model}
            onChange={setModel}
            options={modelCatalog(project, board.config)}
            effective={resolveModel(
              project,
              board.config,
              board.config.stages.find((s) => s.id === stage),
              { model },
            )}
            defaultLabel="Inherit from Stage / Board / Project"
          />
          {schema.map((f) => (
            <FieldInput
              key={f.id}
              id={`${id}-field-${f.id}`}
              field={f}
              value={fields[f.id]}
              onChange={(v) => setFields({ ...fields, [f.id]: v })}
            />
          ))}
          <Tabs value={bodyTab} onValueChange={(v) => setBodyTab(v as "write" | "preview")} className="gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor={`${id}-body`}>Description</Label>
              <TabsList>
                <TabsTrigger value="write">Write</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="write">
              <Textarea
                id={`${id}-body`}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                className="min-h-40 font-mono"
                placeholder="Markdown supported"
              />
            </TabsContent>
            <TabsContent value="preview">
              {/* biome-ignore lint/a11y/noStaticElementInteractions: double-click shortcut; the Write tab is the accessible path */}
              <div
                className="min-h-40 cursor-text rounded-md border px-3 py-2"
                onDoubleClick={() => setBodyTab("write")}
                title="Double-click to edit"
              >
                {body.trim() ? (
                  <Markdown>{body}</Markdown>
                ) : (
                  <p className="text-sm text-muted-foreground">Nothing to preview.</p>
                )}
              </div>
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim()}>
              {story ? "Save" : "Create Story"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type FieldProps = { id: string; field: FieldDef; value: unknown; onChange: (v: unknown) => void };

function FieldInput({ id, field, value, onChange }: FieldProps) {
  const labelled = (input: ReactNode) => (
    <div className="grid gap-2">
      <Label htmlFor={id}>{field.name}</Label>
      {input}
    </div>
  );
  switch (field.type) {
    case "number":
      return labelled(
        <Input
          id={id}
          type="number"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />,
      );
    case "boolean":
      return (
        <div className="flex items-center gap-2">
          <Checkbox id={id} checked={value === true} onCheckedChange={(c) => onChange(c === true)} />
          <Label htmlFor={id}>{field.name}</Label>
        </div>
      );
    case "date":
      return labelled(
        <Input
          id={id}
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
        />,
      );
    case "single-select":
      return labelled(
        <Select
          value={typeof value === "string" && value ? value : NONE}
          onValueChange={(v) => onChange(v === NONE ? null : v)}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>—</SelectItem>
            {field.options?.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>,
      );
    case "multi-select": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">{field.name}</legend>
          {field.options?.map((o, i) => (
            <div key={o} className="flex items-center gap-2">
              <Checkbox
                id={`${id}-${i}`}
                checked={selected.includes(o)}
                onCheckedChange={(c) => {
                  const next = c === true ? [...selected, o] : selected.filter((x) => x !== o);
                  onChange(next.length ? next : null);
                }}
              />
              <Label htmlFor={`${id}-${i}`} className="font-normal">
                {o}
              </Label>
            </div>
          ))}
        </fieldset>
      );
    }
    default:
      return labelled(
        <Input
          id={id}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
        />,
      );
  }
}
