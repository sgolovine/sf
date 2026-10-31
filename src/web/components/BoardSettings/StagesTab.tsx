import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Lock, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import type { StageConfig } from "#model/config";
import type { BoardSnapshot } from "#model/project";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sfApi } from "../../api/client.ts";
import type { Act } from "../ErrorBanner.tsx";
import { FIXED_STAGES } from "./fixed.ts";
import { stageReorderIndex } from "./stage-order.ts";

/** Rename, reorder, remove, and add Stages. Backlog and Done stay first and last. */
export function StagesTab({ board, act }: { board: BoardSnapshot; act: Act }) {
  const stages = board.config.stages;
  const [saving, setSaving] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const instructionsId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const movable = stages.filter((stage) => !FIXED_STAGES.has(stage.id));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stages</CardTitle>
        <CardDescription>
          The columns of the Board, in order. Backlog and Done are fixed. A Stage's HIL flag (a boolean field) holds a
          Story for a human: while it is checked no Worker runs on the Story in that Stage, and unchecking it starts
          one.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p id={instructionsId} className="text-xs text-muted-foreground">
          Drag a Stage by its handle. With a handle focused, press Space or Enter to pick up, use the arrow keys to
          choose a position, then Space or Enter to save. Press Escape to cancel.
        </p>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={({ active }) => setActiveId(String(active.id))}
          onDragCancel={() => setActiveId(null)}
          onDragEnd={async ({ active, over }) => {
            setActiveId(null);
            const index = stageReorderIndex(stages, String(active.id), over ? String(over.id) : null);
            if (index === null) return;
            setSaving(true);
            try {
              await act(() => sfApi.reorderStage(board.id, String(active.id), index));
            } finally {
              setSaving(false);
            }
          }}
        >
          <SortableContext items={movable.map((stage) => stage.id)} strategy={verticalListSortingStrategy}>
            {stages.map((stage, index) => (
              // Remount on rename so the input shows the stored name.
              <StageRow
                key={`${stage.id}:${stage.name}`}
                board={board}
                stage={stage}
                index={index}
                disabled={saving || movable.length < 2}
                instructionsId={instructionsId}
                activeIndex={stages.findIndex((item) => item.id === activeId)}
                stories={board.stories.filter((s) => s.stage === stage.id).length}
                act={act}
              />
            ))}
          </SortableContext>
        </DndContext>
        <AddStage board={board} act={act} />
      </CardContent>
    </Card>
  );
}

type RowProps = {
  board: BoardSnapshot;
  stage: StageConfig;
  index: number;
  disabled: boolean;
  instructionsId: string;
  activeIndex: number;
  stories: number;
  act: Act;
};

function StageRow({ board, stage, index, disabled, instructionsId, activeIndex, stories, act }: RowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isOver } =
    useSortable({
      id: stage.id,
      disabled: FIXED_STAGES.has(stage.id) || disabled,
    });
  const [name, setName] = useState(stage.name);
  if (FIXED_STAGES.has(stage.id)) {
    return (
      <div className="flex h-11 items-center gap-2 rounded-md border bg-muted/40 px-3">
        <Lock className="size-4 text-muted-foreground" />
        <span className="font-medium">{stage.name}</span>
        <Badge variant="outline">fixed</Badge>
        <span className="ml-auto text-sm text-muted-foreground">{plural(stories, "Story", "Stories")}</span>
      </div>
    );
  }
  const changed = name.trim() !== "" && name !== stage.name;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform ? { ...transform, x: 0 } : null), transition }}
      className={`relative flex items-start gap-2 rounded-md border bg-card p-2 ${isDragging ? "z-10 opacity-60 ring-2 ring-primary" : ""}`}
    >
      {isOver && activeIndex !== index && activeIndex >= 0 && (
        <div
          aria-hidden="true"
          className={`absolute right-0 left-0 h-1 rounded bg-primary ${activeIndex < index ? "-bottom-1" : "-top-1"}`}
        />
      )}
      <Button
        ref={setActivatorNodeRef}
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0 touch-none cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${stage.name}`}
        aria-describedby={instructionsId}
        aria-disabled={disabled}
      >
        <GripVertical />
      </Button>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (changed) void act(() => sfApi.updateStage(board.id, stage.id, { name }));
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={`Name of ${stage.name}`}
            className="h-8 min-w-24 max-w-xs flex-1"
          />
          {changed && (
            <Button type="submit" size="sm">
              Rename
            </Button>
          )}
          <span className="text-xs text-muted-foreground">id: {stage.id}</span>
          <span className="ml-auto text-sm text-muted-foreground">{plural(stories, "Story", "Stories")}</span>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${stage.name}`}>
                <Trash2 className="text-destructive" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove Stage {stage.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  The column and its Stage Prompt are removed from {board.config.name}.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => act(() => sfApi.removeStage(board.id, stage.id))}
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </form>
        <HilFields board={board} stage={stage} act={act} />
      </div>
    </div>
  );
}

/** Radix Select items cannot have an empty value; this one stands for "none". */
const NONE = "__none__";

/** The Stage's HIL flag (a boolean field) and HIL comment (a text field). Saves on change. */
function HilFields({ board, stage, act }: { board: BoardSnapshot; stage: StageConfig; act: Act }) {
  const id = useId();
  const fields = (type: string) => board.config.schema.filter((f) => f.type === type);
  const pick = (label: string, key: "hilFlag" | "hilComment", type: string, value: string | undefined) => (
    <div className="flex max-w-full flex-wrap items-center gap-2">
      <Label htmlFor={`${id}-${key}`} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      <Select
        value={value ?? NONE}
        disabled={key === "hilComment" && !stage.hil}
        onValueChange={(v) => act(() => sfApi.updateStage(board.id, stage.id, { [key]: v === NONE ? null : v }))}
      >
        <SelectTrigger id={`${id}-${key}`} size="sm" className="h-7 w-48 max-w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>none</SelectItem>
          {fields(type).map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {pick("HIL flag", "hilFlag", "boolean", stage.hil?.flag)}
      {pick("HIL comment", "hilComment", "text", stage.hil?.comment)}
    </div>
  );
}

function AddStage({ board, act }: { board: BoardSnapshot; act: Act }) {
  const [name, setName] = useState("");
  return (
    <form
      className="mt-2 flex items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await act(() => sfApi.addStage(board.id, name))) setName("");
      }}
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New Stage"
        className="max-w-xs"
        aria-label="New Stage name"
      />
      <Button type="submit" variant="outline" disabled={!name.trim()}>
        Add Stage
      </Button>
    </form>
  );
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}
