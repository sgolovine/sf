import { Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { Attachment } from "#model/attachment";
import type { ProjectConfig } from "#model/config";
import { activeHil, type FieldDef } from "#model/config";
import { modelCatalog, resolveModel } from "#model/models";
import type { BoardSnapshot, StoryView } from "#model/project";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { ApiError, sfApi } from "../api/client.ts";
import { DependencyPicker } from "./DependencyPicker.tsx";
import type { Act } from "./ErrorBanner.tsx";
import { Markdown } from "./Markdown.tsx";
import { ModelSelector } from "./ModelSelector.tsx";
import { encodeAttachments, StoryAttachments } from "./StoryAttachments.tsx";

type Props = {
  project: ProjectConfig;
  board: BoardSnapshot;
  /** Every Board in the Project, for cross-Board dependency candidates. */
  boards: BoardSnapshot[];
  story: StoryView | null;
  initialStage?: string;
  act: Act;
  onClose: () => void;
};

/** Radix Select items cannot have an empty value; this one stands for "no value". */
const NONE = "__none__";

/** Create or edit a Story. Custom field inputs follow the Board's Story schema. */
export function StoryEditor({ project, board, boards, story, initialStage = "backlog", act, onClose }: Props) {
  const id = useId();
  const [title, setTitle] = useState(story?.title ?? "");
  const [stage, setStage] = useState(story?.stage ?? initialStage);
  const [dependsOn, setDependsOn] = useState<string[]>(story?.dependsOn ?? []);
  const [model, setModel] = useState(story?.model ?? "");
  const legacyModel = board.config.schema.some((f) => f.id === "model");
  useEffect(() => {
    setModel(story?.model ?? "");
    setStage(story?.stage ?? initialStage);
  }, [story?.model, story?.stage, initialStage]);
  const [body, setBody] = useState(story?.body ?? "");
  // Open existing descriptions rendered; start empty ones ready to type.
  const [bodyTab, setBodyTab] = useState<"write" | "preview">(story?.body.trim() ? "preview" : "write");
  const [fields, setFields] = useState<Record<string, unknown>>(story?.fields ?? {});
  const [pending, setPending] = useState<File[]>([]);
  const [persisted, setPersisted] = useState<Attachment[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [retryOnly, setRetryOnly] = useState(false);
  const storyKey = story?.key;
  const submissionId = useRef(crypto.randomUUID());
  const submission = useRef<Parameters<typeof sfApi.createStory>[0] | null>(null);
  useEffect(() => {
    if (storyKey)
      void sfApi
        .listAttachments(storyKey)
        .then(setPersisted)
        .catch((err: Error) => setError(err.message));
  }, [storyKey]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const schema = board.config.schema.filter((f) => f.id !== "model");
  const hil = story && activeHil(board.config, story);

  const save = async () => {
    if (submitting || deleting || confirmDelete) return;
    setSubmitting(true);
    setError("");
    try {
      const values = Object.fromEntries(schema.map((f) => [f.id, fields[f.id] ?? null]));
      // Keep the exact request across uncertain transport failures.
      submission.current ??= {
        board: board.id,
        title,
        stage,
        body,
        dependsOn,
        fields: values,
        ...(!legacyModel ? { model: model || null } : {}),
        attachments: await encodeAttachments(pending),
        submissionId: submissionId.current,
      };
      if (story) await sfApi.updateStory(story.key, submission.current);
      else await sfApi.createStory(submission.current);
      await act(async () => {});
      onClose();
    } catch (err) {
      setError((err as Error).message);
      // Definitive rejections can be edited; transport errors retry the same submission.
      const uncertain = err instanceof TypeError || (err instanceof ApiError && !err.code);
      setRetryOnly(uncertain);
      if (uncertain) setError(`${(err as Error).message}. Retry to confirm this submission before editing it.`);
      else submission.current = null;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting && !deleting && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={submitting || deleting || retryOnly} className="contents">
            <DialogHeader>
              <DialogTitle>{story ? story.key : `New Story on ${board.config.name}`}</DialogTitle>
              <DialogDescription>
                {story
                  ? `Stage: ${board.config.stages.find((s) => s.id === story.stage)?.name ?? story.stage}${story.branch ? ` · branch ${story.branch}` : ""}`
                  : "Describe the work; custom fields follow the Board's settings."}
              </DialogDescription>
            </DialogHeader>
            {story?.waitingOnDependencies && (
              <p className="rounded-md border bg-muted px-3 py-2 text-sm">
                Waiting on dependencies: {story.unresolvedDependencies?.join(", ")}. This Stage resumes when all are
                Done and other holds are cleared.
              </p>
            )}
            {hil && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p className="font-semibold">Needs a human</p>
                {hil.comment && <p className="whitespace-pre-wrap">{hil.comment}</p>}
                <p className="mt-1 text-xs">
                  No Worker runs while {schema.find((f) => f.id === hil.flag)?.name ?? hil.flag} is checked. Uncheck it
                  and save to resume when dependencies are Done.
                </p>
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
                board.config.stages.find((s) => s.id === (story?.stage ?? stage)),
                { model },
              )}
              defaultLabel="Inherit from Stage / Board / Project"
            />
            <Tabs defaultValue="details" className="min-w-0 gap-4">
              <TabsList aria-label="Story sections">
                <TabsTrigger type="button" value="details">
                  Details
                </TabsTrigger>
                <TabsTrigger type="button" value="fields">
                  Custom Fields
                </TabsTrigger>
              </TabsList>
              <TabsContent value="details" className="min-w-0 space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor={`${id}-title`}>Title</Label>
                  <Input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
                </div>
                {story ? (
                  <div className="grid gap-2">
                    <span className="text-sm font-medium">Stage</span>
                    <p className="text-sm">
                      {board.config.stages.find((s) => s.id === story.stage)?.name ?? story.stage}
                    </p>
                  </div>
                ) : (
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
                <div className="grid gap-2">
                  <Label htmlFor={`${id}-dependencies`}>Depends on</Label>
                  <DependencyPicker
                    id={`${id}-dependencies`}
                    value={dependsOn}
                    onChange={setDependsOn}
                    boards={boards}
                    boardId={board.id}
                    selfKey={story?.key}
                    disabled={submitting || deleting || retryOnly}
                  />
                  <p className="text-xs text-muted-foreground">
                    Stories in this Project. Workers wait until all are Done.
                  </p>
                </div>
                <Tabs value={bodyTab} onValueChange={(v) => setBodyTab(v as "write" | "preview")} className="gap-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor={`${id}-body`}>Description</Label>
                    <TabsList aria-label="Description mode">
                      <TabsTrigger type="button" value="write">
                        Write
                      </TabsTrigger>
                      <TabsTrigger type="button" value="preview">
                        Preview
                      </TabsTrigger>
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
              </TabsContent>
              <TabsContent value="fields" className="min-w-0 space-y-4">
                {schema.length ? (
                  schema.map((f) => (
                    <FieldInput
                      key={f.id}
                      id={`${id}-field-${f.id}`}
                      field={f}
                      value={fields[f.id]}
                      onChange={(v) => setFields({ ...fields, [f.id]: v })}
                    />
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No custom fields.</p>
                )}
              </TabsContent>
            </Tabs>
            <StoryAttachments
              storyKey={story?.key}
              persisted={persisted}
              pending={pending}
              setPending={setPending}
              error={error}
              setError={setError}
              disabled={submitting || deleting || retryOnly}
            />
          </fieldset>
          <DialogFooter>
            {story && (
              <AlertDialog open={confirmDelete} onOpenChange={(open) => !deleting && setConfirmDelete(open)}>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mr-auto"
                    aria-label={`Delete ${story.key}`}
                    disabled={submitting || deleting || retryOnly}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {story.key}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Permanently delete {story.key}: {story.title}? This cannot be undone. Any Story Worktree and
                      branch are retained. A live Claim must be released first.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel type="button" disabled={deleting}>
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      type="button"
                      variant="destructive"
                      disabled={deleting}
                      onClick={async (e) => {
                        e.preventDefault();
                        if (deleting || submitting || retryOnly) return;
                        setDeleting(true);
                        try {
                          if (await act(() => sfApi.deleteStory(story.key))) onClose();
                          else setConfirmDelete(false);
                        } finally {
                          setDeleting(false);
                        }
                      }}
                    >
                      {deleting ? "Deleting…" : "Delete Story"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting || deleting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || deleting || confirmDelete || !title.trim()}>
              {retryOnly ? "Retry submission" : story ? "Save" : "Create Story"}
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
