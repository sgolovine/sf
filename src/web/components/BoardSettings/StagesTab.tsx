import { ArrowDown, ArrowUp, Lock, Trash2 } from "lucide-react";
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

/** Rename, reorder, remove, and add Stages. Backlog and Done stay first and last. */
export function StagesTab({ board, act }: { board: BoardSnapshot; act: Act }) {
  const stages = board.config.stages;
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
        {stages.map((stage, index) => (
          // Remount on rename so the input shows the stored name.
          <StageRow
            key={`${stage.id}:${stage.name}`}
            board={board}
            stage={stage}
            index={index}
            count={stages.length}
            stories={board.stories.filter((s) => s.stage === stage.id).length}
            act={act}
          />
        ))}
        <AddStage board={board} act={act} />
      </CardContent>
    </Card>
  );
}

type RowProps = { board: BoardSnapshot; stage: StageConfig; index: number; count: number; stories: number; act: Act };

function StageRow({ board, stage, index, count, stories, act }: RowProps) {
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
    <div className="flex flex-col gap-1.5 rounded-md border px-3 py-1.5">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (changed) void act(() => sfApi.updateStage(board.id, stage.id, { name }));
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={`Name of ${stage.name}`}
          className="h-8 max-w-xs"
        />
        {changed && (
          <Button type="submit" size="sm">
            Rename
          </Button>
        )}
        <span className="text-xs text-muted-foreground">id: {stage.id}</span>
        <span className="ml-auto text-sm text-muted-foreground">{plural(stories, "Story", "Stories")}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${stage.name} up`}
          disabled={index <= 1}
          onClick={() => act(() => sfApi.reorderStage(board.id, stage.id, index - 1))}
        >
          <ArrowUp />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${stage.name} down`}
          disabled={index >= count - 2}
          onClick={() => act(() => sfApi.reorderStage(board.id, stage.id, index + 1))}
        >
          <ArrowDown />
        </Button>
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
              <AlertDialogAction variant="destructive" onClick={() => act(() => sfApi.removeStage(board.id, stage.id))}>
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </form>
      <HilFields board={board} stage={stage} act={act} />
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
    <div className="flex items-center gap-2">
      <Label htmlFor={`${id}-${key}`} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      <Select
        value={value ?? NONE}
        disabled={key === "hilComment" && !stage.hil}
        onValueChange={(v) => act(() => sfApi.updateStage(board.id, stage.id, { [key]: v === NONE ? null : v }))}
      >
        <SelectTrigger id={`${id}-${key}`} size="sm" className="h-7 w-48 text-xs">
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
