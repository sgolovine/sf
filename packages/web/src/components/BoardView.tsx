import { useState } from "react";
import type { BoardSnapshot, RuntimeState, StageConfig } from "@sf/protocol";
import { sfApi } from "../api/client.ts";
import type { Act } from "./ErrorBanner.tsx";
import { StoryCard } from "./StoryCard.tsx";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Props = {
  board: BoardSnapshot;
  runtime: RuntimeState;
  act: Act;
  onOpenStory: (key: string) => void;
  /** Opens Board Settings on the Stages tab. */
  onOpenStages: () => void;
};

const columnClass = "flex min-h-32 w-72 shrink-0 flex-col gap-2 rounded-lg bg-muted p-2";

/** The kanban: one column per Stage. Drag a card onto a column, or use its "Move to…" menu. */
export function BoardView({ board, runtime, act, onOpenStory, onOpenStages }: Props) {
  const { stages } = board.config;
  const [over, setOver] = useState<string | null>(null);
  const known = new Set(stages.map((s) => s.id));
  const orphans = board.stories.filter((s) => !known.has(s.stage));

  const column = (stage: StageConfig) => {
    const stories = board.stories.filter((s) => s.stage === stage.id);
    const prompt = (board.prompts[stage.id] ?? "").trim();
    return (
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
        <header className="flex items-center justify-between gap-2 px-1">
          <button
            type="button"
            className="cursor-pointer truncate rounded-sm text-sm font-semibold hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            onClick={onOpenStages}
            title="Board Settings: Stages"
          >
            {stage.name} <span className="font-normal text-muted-foreground">{stories.length}</span>
          </button>
          {stage.promptEnabled && (
            <Badge variant={prompt ? "default" : "outline"} className={cn(!prompt && "text-muted-foreground")}>
              {prompt ? "Worker" : "no prompt"}
            </Badge>
          )}
        </header>
        {stories.map((s) => (
          <StoryCard key={s.key} story={s} stages={stages} runtime={runtime} act={act} onOpen={() => onOpenStory(s.key)} />
        ))}
      </section>
    );
  };

  return (
    <div className="flex flex-1 items-start gap-3 overflow-x-auto p-4">
      {stages.map(column)}
      {orphans.length > 0 && (
        <section className={cn(columnClass, "border border-dashed border-destructive/50")}>
          <header className="px-1 text-sm font-semibold text-destructive">Unknown Stage</header>
          {orphans.map((s) => (
            <StoryCard key={s.key} story={s} stages={stages} runtime={runtime} act={act} onOpen={() => onOpenStory(s.key)} />
          ))}
        </section>
      )}
    </div>
  );
}
