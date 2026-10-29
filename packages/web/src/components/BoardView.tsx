import { useState } from "react";
import type { BoardSnapshot, RuntimeState, StageConfig } from "@sf/protocol";
import { sfApi } from "../api/client.ts";
import type { Act } from "./ErrorBanner.tsx";
import { StoryCard } from "./StoryCard.tsx";

type Props = {
  board: BoardSnapshot;
  runtime: RuntimeState;
  act: Act;
  onOpenStory: (key: string) => void;
  onOpenStage: (stageId: string) => void;
};

/** The kanban: one column per Stage. Drag a card onto a column, or use its "Move to…" menu. */
export function BoardView({ board, runtime, act, onOpenStory, onOpenStage }: Props) {
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
        className={`column${over === stage.id ? " drop" : ""}`}
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
        <header>
          <button type="button" className="column-title" onClick={() => onOpenStage(stage.id)} title="Stage settings">
            {stage.name} <span className="count">{stories.length}</span>
          </button>
          <span className={`prompt-flag${stage.promptEnabled && prompt ? " on" : ""}`}>
            {stage.promptEnabled && prompt ? "Worker" : stage.promptEnabled ? "no prompt" : ""}
          </span>
        </header>
        {stories.map((s) => (
          <StoryCard key={s.key} story={s} stages={stages} runtime={runtime} act={act} onOpen={() => onOpenStory(s.key)} />
        ))}
      </section>
    );
  };

  return (
    <div className="board">
      {stages.map(column)}
      {orphans.length > 0 && (
        <section className="column orphans">
          <header>Unknown Stage</header>
          {orphans.map((s) => (
            <StoryCard key={s.key} story={s} stages={stages} runtime={runtime} act={act} onOpen={() => onOpenStory(s.key)} />
          ))}
        </section>
      )}
      <AddStage board={board} act={act} />
    </div>
  );
}

function AddStage({ board, act }: { board: BoardSnapshot; act: Act }) {
  const [name, setName] = useState("");
  return (
    <form
      className="column add-stage"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await act(() => sfApi.addStage(board.id, name))) setName("");
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New Stage" />
      <button type="submit" disabled={!name.trim()}>
        Add Stage
      </button>
    </form>
  );
}
