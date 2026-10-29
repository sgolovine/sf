import { useState, type ReactNode } from "react";
import { useSession } from "./api/hooks.ts";
import { AppSidebar } from "./components/AppSidebar.tsx";
import { BoardSettings, type SettingsTab } from "./components/BoardSettings/BoardSettings.tsx";
import { BoardView } from "./components/BoardView.tsx";
import { CreateBoard } from "./components/CreateBoard.tsx";
import { ErrorBanner, type Act } from "./components/ErrorBanner.tsx";
import { StoryEditor } from "./components/StoryEditor.tsx";
import { ArrowLeft, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/** What the main area shows. Navigation is plain state: the URL hash carries the auth token. */
type View =
  | { kind: "board"; boardId: string | null }
  | { kind: "settings"; boardId: string; tab: SettingsTab }
  | { kind: "create-board" };

/** The Story being edited in the dialog; key null means a new Story. */
type Editing = { key: string | null } | null;

export function App() {
  const { data: session, error } = useSession();
  const [view, setView] = useState<View>({ kind: "board", boardId: null });
  const [editing, setEditing] = useState<Editing>(null);
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
  const selectedId = view.kind === "create-board" ? null : view.boardId;
  const board = boards.find((b) => b.id === selectedId) ?? boards[0];
  const creating = view.kind === "create-board" || !board;
  const settings = view.kind === "settings" && board?.id === view.boardId ? view : null;
  const openBoard = (boardId: string) => {
    setView({ kind: "board", boardId });
    setEditing(null);
  };
  const openSettings = (boardId: string, tab: SettingsTab) => {
    setView({ kind: "settings", boardId, tab });
    setEditing(null);
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
          setEditing(null);
        }}
      />
      <SidebarInset className="min-w-0">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <h1 className="truncate font-medium">
            {creating ? "New Board" : settings ? `${board.config.name} · Board Settings` : board.config.name}
          </h1>
          {!creating && settings && (
            <Button size="sm" variant="outline" onClick={() => openBoard(board.id)}>
              <ArrowLeft /> Back to board
            </Button>
          )}
          {!creating && !settings && (
            <>
              <Button size="sm" onClick={() => setEditing({ key: null })}>
                New Story
              </Button>
              <Button size="sm" variant="outline" onClick={() => openSettings(board.id, "stages")}>
                <Settings /> Board Settings
              </Button>
            </>
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
        ) : settings ? (
          <BoardSettings board={board} tab={settings.tab} onTab={(tab) => openSettings(board.id, tab)} act={act} />
        ) : (
          <BoardView
            board={board}
            runtime={project!.runtime}
            act={act}
            onOpenStory={(key) => setEditing({ key })}
            onOpenStages={() => openSettings(board.id, "stages")}
          />
        )}

        {!creating && editing && (
          <StoryEditor
            key={editing.key ?? "new"}
            board={board}
            story={board.stories.find((s) => s.key === editing.key) ?? null}
            act={act}
            onClose={() => setEditing(null)}
          />
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <p className="grid min-h-svh place-items-center p-6 text-muted-foreground">{children}</p>;
}
