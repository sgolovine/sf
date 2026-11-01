import { Plus } from "lucide-react";
import { useState } from "react";
import type { StageConfig } from "#model/config";
import type { BoardSnapshot } from "#model/project";
import type { RuntimeState } from "#model/runtime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sfApi } from "../api/client.ts";
import type { Act } from "./ErrorBanner.tsx";
import { StoryCard } from "./StoryCard.tsx";

type Props = {
  board: BoardSnapshot;
  runtime: RuntimeState;
  act: Act;
  onOpenStory: (key: string) => void;
  onCreateStory: (stageId: string) => void;
  /** Opens Settings on the Board's Stages section. */
  onOpenStages: () => void;
};

// Columns stretch to the Board's height; cards scroll in their own region so the footer stays at the bottom.
const columnClass = "flex min-h-48 w-72 shrink-0 flex-col gap-2 rounded-lg bg-muted p-2";
const cardsClass = "-mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1";

/** The kanban: one column per Stage. Drag a card onto a column to Move its Story. */
export function BoardView({ board, runtime, act, onOpenStory, onOpenStages, onCreateStory }: Props) {
  const { stages } = board.config;
  const [over, setOver] = useState<string | null>(null);
  const known = new Set(stages.map((s) => s.id));
  const orphans = board.stories.filter((s) => !known.has(s.stage));

  const column = (stage: StageConfig) => {
    const stories = board.stories.filter((s) => s.stage === stage.id);
    const prompt = (board.prompts[stage.id] ?? "").trim();
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: drop target for pointer drag-and-drop
      <section
        key={stage.id}
        className={cn(columnClass, over === stage.id && "outline-2 outline-ring outline-dashed")}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(stage.id);
        }}
        onDragLeave={() => setOver(null)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(null);
          const key = e.dataTransfer.getData("text/sf-story");
          const story = board.stories.find((s) => s.key === key);
          if (story && story.stage !== stage.id) void act(() => sfApi.moveStory(key, stage.id));
        }}
      >
        <header className="flex h-6 shrink-0 items-center justify-between gap-2 px-1">
          <button
            type="button"
            className="cursor-pointer truncate rounded-sm text-sm font-semibold hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            onClick={onOpenStages}
            title="Settings: Stages"
          >
            {stage.name} <span className="font-normal text-muted-foreground">{stories.length}</span>
          </button>
          {stage.promptEnabled && (
            <Badge variant={prompt ? "default" : "outline"} className={cn(!prompt && "text-muted-foreground")}>
              {prompt ? "Worker" : "no prompt"}
            </Badge>
          )}
        </header>
        <div className={cardsClass}>
          {stories.map((s) => (
            <StoryCard
              key={s.key}
              story={s}
              board={board.config}
              runtime={runtime}
              act={act}
              onOpen={() => onOpenStory(s.key)}
            />
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 justify-start bg-muted text-muted-foreground"
          aria-label={`New Story in ${stage.name}`}
          onClick={() => onCreateStory(stage.id)}
        >
          <Plus />
          New Story
        </Button>
      </section>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-auto p-4">
      {stages.map(column)}
      {orphans.length > 0 && (
        <section className={cn(columnClass, "border border-dashed border-destructive/50")}>
          <header className="flex h-6 shrink-0 items-center px-1 text-sm font-semibold text-destructive">
            Unknown Stage
          </header>
          <div className={cardsClass}>
            {orphans.map((s) => (
              <StoryCard
                key={s.key}
                story={s}
                board={board.config}
                runtime={runtime}
                act={act}
                onOpen={() => onOpenStory(s.key)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
