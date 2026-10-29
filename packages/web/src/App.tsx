import { useState, type ReactNode } from "react";
import { useSession } from "./api/hooks.ts";
import { AppSidebar } from "./components/AppSidebar.tsx";
import { BoardView } from "./components/BoardView.tsx";
import { CreateBoard } from "./components/CreateBoard.tsx";
import { ErrorBanner, type Act } from "./components/ErrorBanner.tsx";
import { SchemaEditor } from "./components/SchemaEditor.tsx";
import { StageSettings } from "./components/StageSettings.tsx";
import { StoryEditor } from "./components/StoryEditor.tsx";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/** What the main area shows. Navigation is plain state: the URL hash carries the auth token. */
type View = { kind: "board"; boardId: string | null } | { kind: "create-board" };

type Panel = { kind: "story"; key: string | null } | { kind: "stage"; stageId: string } | { kind: "schema" } | null;

export function App() {
  const { data: session, error } = useSession();
  const [view, setView] = useState<View>({ kind: "board", boardId: null });
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

  if (error) return <Centered>Could not reach the sf-factory server: {error.message}</Centered>;
  if (!session) return <Centered>Connecting…</Centered>;

  const { capabilities, listening } = session.supervisor;
  const project = session.project;
  const boards = project?.boards ?? [];
  const selectedId = view.kind === "board" ? view.boardId : null;
  const board = boards.find((b) => b.id === selectedId) ?? boards[0];
  const creating = view.kind === "create-board" || !board;
  const openBoard = (boardId: string) => {
    setView({ kind: "board", boardId });
    setPanel(null);
  };

  return (
    <SidebarProvider>
      <AppSidebar
        boards={boards}
        activeId={board?.id}
        creating={creating}
        onSelect={openBoard}
        onNewBoard={() => {
          setView({ kind: "create-board" });
          setPanel(null);
        }}
      />
      <SidebarInset className="min-w-0">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <h1 className="truncate font-medium">{creating ? "New Board" : board.config.name}</h1>
          {!creating && (
            <Button size="sm" onClick={() => setPanel({ kind: "story", key: null })}>
              New Story
            </Button>
          )}
          <span className="flex-1" />
          {project && (
            <span className="text-sm text-muted-foreground">
              Workers {Object.keys(project.runtime.claims).length}/{project.config.maxConcurrentWorkers}
              {project.runtime.queue.length > 0 && ` · ${project.runtime.queue.length} waiting`}
            </span>
          )}
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className={cn("size-2 rounded-full", listening ? "bg-emerald-500" : "bg-muted-foreground/40")} />
            Supervisor: {capabilities ? `${capabilities.agent} · ${capabilities.app}` : "not registered"} ·{" "}
            {listening ? "listening" : "busy or away"}
          </span>
        </header>
        {failure && <ErrorBanner message={failure} onDismiss={() => setFailure(null)} />}

        {creating ? (
          <CreateBoard act={act} onCreated={openBoard} onCancel={board ? () => openBoard(board.id) : undefined} />
        ) : (
          <BoardView
            board={board}
            runtime={project!.runtime}
            act={act}
            onOpenStory={(key) => setPanel({ kind: "story", key })}
            onOpenStage={(stageId) => setPanel({ kind: "stage", stageId })}
          />
        )}

        {!creating && panel?.kind === "story" && (
          <StoryEditor
            key={panel.key ?? "new"}
            board={board}
            story={board.stories.find((s) => s.key === panel.key) ?? null}
            act={act}
            onClose={() => setPanel(null)}
          />
        )}
        {!creating && panel?.kind === "stage" && (
          <StageSettings key={panel.stageId} board={board} stageId={panel.stageId} act={act} onClose={() => setPanel(null)} />
        )}
        {!creating && panel?.kind === "schema" && <SchemaEditor board={board} act={act} onClose={() => setPanel(null)} />}
      </SidebarInset>
    </SidebarProvider>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <p className="grid min-h-svh place-items-center p-6 text-muted-foreground">{children}</p>;
}
