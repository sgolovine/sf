import { useState } from "react";
import { useSession } from "./api/hooks.ts";
import { BoardView } from "./components/BoardView.tsx";
import { CreateBoard } from "./components/CreateBoard.tsx";
import { ErrorBanner, type Act } from "./components/ErrorBanner.tsx";
import { SchemaEditor } from "./components/SchemaEditor.tsx";
import { StageSettings } from "./components/StageSettings.tsx";
import { StoryEditor } from "./components/StoryEditor.tsx";

type Panel =
  | { kind: "story"; key: string | null }
  | { kind: "stage"; stageId: string }
  | { kind: "schema" }
  | { kind: "create-board" }
  | null;

export function App() {
  const { data: session, error } = useSession();
  const [boardId, setBoardId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const act: Act = async (fn) => {
    try {
      await fn();
      setFailure(null);
      return true;
    } catch (err) {
      setFailure((err as Error).message);
      return false;
    }
  };

  if (error) return <p className="center">Could not reach the sf-factory server: {error.message}</p>;
  if (!session) return <p className="center">Connecting…</p>;

  const { capabilities, listening } = session.supervisor;
  const project = session.project;
  const boards = project?.boards ?? [];
  const board = boards.find((b) => b.id === boardId) ?? boards[0];
  const banner = failure && <ErrorBanner message={failure} onDismiss={() => setFailure(null)} />;

  return (
    <div className="app">
      <header className="topbar">
        <h1>sf</h1>
        {boards.length > 0 && (
          <select value={board?.id} onChange={(e) => setBoardId(e.target.value)} aria-label="Board">
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.config.name} ({b.config.key})
              </option>
            ))}
          </select>
        )}
        {board && (
          <>
            <button type="button" className="primary" onClick={() => setPanel({ kind: "story", key: null })}>
              New Story
            </button>
            <button type="button" onClick={() => setPanel({ kind: "schema" })}>
              Story fields
            </button>
            <button type="button" onClick={() => setPanel({ kind: "create-board" })}>
              New Board
            </button>
          </>
        )}
        <span className="spacer" />
        {project && (
          <span className="muted">
            Workers {Object.keys(project.runtime.claims).length}/{project.config.maxConcurrentWorkers}
            {project.runtime.queue.length > 0 && ` · ${project.runtime.queue.length} waiting`}
          </span>
        )}
        <span className={`supervisor${listening ? " listening" : ""}`}>
          Supervisor: {capabilities ? `${capabilities.agent} · ${capabilities.app}` : "not registered"} ·{" "}
          {listening ? "listening" : "busy or away"}
        </span>
      </header>
      {banner}

      {!board || panel?.kind === "create-board" ? (
        <CreateBoard
          act={act}
          onCreated={(id) => {
            setBoardId(id);
            setPanel(null);
          }}
          onCancel={board ? () => setPanel(null) : undefined}
        />
      ) : (
        <BoardView
          board={board}
          runtime={project!.runtime}
          act={act}
          onOpenStory={(key) => setPanel({ kind: "story", key })}
          onOpenStage={(stageId) => setPanel({ kind: "stage", stageId })}
        />
      )}

      {board && panel?.kind === "story" && (
        <StoryEditor
          key={panel.key ?? "new"}
          board={board}
          story={board.stories.find((s) => s.key === panel.key) ?? null}
          act={act}
          onClose={() => setPanel(null)}
        />
      )}
      {board && panel?.kind === "stage" && (
        <StageSettings key={panel.stageId} board={board} stageId={panel.stageId} act={act} onClose={() => setPanel(null)} />
      )}
      {board && panel?.kind === "schema" && <SchemaEditor board={board} act={act} onClose={() => setPanel(null)} />}
    </div>
  );
}
