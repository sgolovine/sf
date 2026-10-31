import { ArrowLeft, Plus, Settings } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useSession } from "./api/hooks.ts";
import { AppSidebar } from "./components/AppSidebar.tsx";
import { BoardSettings, type SettingsTab } from "./components/BoardSettings/BoardSettings.tsx";
import { BoardView } from "./components/BoardView.tsx";
import { CreateBoard } from "./components/CreateBoard.tsx";
import { type Act, ErrorBanner } from "./components/ErrorBanner.tsx";
import { ModelSettings } from "./components/ModelSettings.tsx";
import { StoryEditor } from "./components/StoryEditor.tsx";
import { NO_STORY, parseStoryPath, type StoryRoute, storyPath } from "./lib/storyRoute.ts";

/**
 * What the main area shows. Views are plain state; only the Story dialog has a URL path
 * (see storyRoute.ts). The URL hash carries the auth token.
 */
type View =
  | { kind: "board"; boardId: string | null }
  | { kind: "settings"; boardId: string; tab: SettingsTab }
  | { kind: "project-settings" };

export function App() {
  const { data: session, error } = useSession();
  const [view, setView] = useState<View>({ kind: "board", boardId: null });
  const [route, setRoute] = useState<StoryRoute>(() => parseStoryPath(location.pathname));
  /** The Stage a new Story starts in when created from a Stage column; not part of the URL. */
  const [createStage, setCreateStage] = useState<string>();
  const [creating, setCreating] = useState(false);
  const initialized = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const emptyAction = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (session && !initialized.current) {
      initialized.current = true;
      setCreating(!session.project?.boards.length);
    }
  }, [session]);
  const [failure, setFailure] = useState<string | null>(null);

  /** Opening or closing the dialog pushes a history entry; `replace` corrects the current one. */
  const navigate = (next: StoryRoute, replace = false) => {
    if (replace) history.replaceState(null, "", storyPath(next));
    else history.pushState(null, "", storyPath(next));
    setRoute(next);
  };
  const closeStory = () => {
    if (route.kind !== "none") navigate(NO_STORY);
  };
  const openCreateStory = (initialStage?: string) => {
    setCreateStage(initialStage);
    navigate({ kind: "create" });
  };
  const openCreateBoard = () => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCreating(true);
    closeStory();
  };

  useEffect(() => {
    // Back/Forward onto a Story path leaves Create a Board, so only one dialog is ever open.
    const sync = () => {
      const next = parseStoryPath(location.pathname);
      if (next.kind !== "none") setCreating(false);
      setRoute(next);
    };
    addEventListener("popstate", sync);
    return () => removeEventListener("popstate", sync);
  }, []);

  // Once the session has loaded, show the Board the route needs, or replace a path that names
  // nothing (an unknown path or key, a deleted Story, `/create` with no Boards) with `/`.
  useEffect(() => {
    if (!session) return;
    const boards = session.project?.boards ?? [];
    const boardId = view.kind === "project-settings" ? null : view.boardId;
    if (route.kind === "edit") {
      const owner = boards.find((b) => b.stories.some((s) => s.key === route.key));
      if (!owner) navigate(NO_STORY, true);
      else if (view.kind !== "board" || (boardId ?? boards[0]?.id) !== owner.id)
        setView({ kind: "board", boardId: owner.id });
    } else if (route.kind === "create") {
      if (boards.length === 0) navigate(NO_STORY, true);
      else if (view.kind !== "board") setView({ kind: "board", boardId });
    } else if (location.pathname !== "/") {
      navigate(NO_STORY, true);
    }
  });

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

  if (error) return <Centered>Could not reach the sf server: {error.message}</Centered>;
  if (!session) return <Centered>Connecting…</Centered>;

  const { capabilities, listening } = session.supervisor;
  const project = session.project;
  const boards = project?.boards ?? [];
  const selectedId = view.kind === "project-settings" ? null : view.boardId;
  const board = boards.find((b) => b.id === selectedId) ?? boards[0];
  const settings = view.kind === "settings" && board?.id === view.boardId ? view : null;
  const supervisorText =
    `Supervisor: ${capabilities ? `${capabilities.agent} · ${capabilities.app}` : "not registered"}` +
    ` · ${listening ? "listening" : "busy or away"}`;
  // Never fall back to a new Story for a key that is not (yet) on the shown Board.
  const editingStory = route.kind === "edit" ? board?.stories.find((s) => s.key === route.key) : undefined;
  const openView = (next: View) => {
    setView(next);
    closeStory();
  };
  const openBoard = (boardId: string) => openView({ kind: "board", boardId });
  const openSettings = (boardId: string, tab: SettingsTab) => openView({ kind: "settings", boardId, tab });

  return (
    <SidebarProvider>
      <AppSidebar
        boards={boards}
        title={board?.config.name}
        activeId={board?.id}
        creating={creating}
        onProjectSettings={() => openView({ kind: "project-settings" })}
        onSelect={openBoard}
        onNewBoard={openCreateBoard}
      />
      {/* Fixed height: only the content region scrolls, so the header and footer stay in place. */}
      <SidebarInset className="h-svh min-w-0">
        {/* Container queries hide secondary text when the main area (not the window) is narrow. */}
        <header className="@container/header flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger className="shrink-0" />
          {/* The sidebar shows the Board name; the header names only the other views. */}
          {(view.kind === "project-settings" || settings) && (
            <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          )}
          <h1
            className={cn("min-w-0 truncate font-medium", view.kind !== "project-settings" && !settings && "sr-only")}
          >
            {view.kind === "project-settings"
              ? "Project settings"
              : settings
                ? "Board Settings"
                : (board?.config.name ?? "Boards")}
          </h1>
          {board && settings && (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => openBoard(board.id)}
              aria-label="Back to board"
            >
              <ArrowLeft />
              <span className="hidden @md/header:inline">Back to board</span>
            </Button>
          )}
          <span className="flex-1" />
          {board && !settings && view.kind !== "project-settings" && (
            <>
              <Button size="sm" className="shrink-0" onClick={() => openCreateStory()} aria-label="New Story">
                <Plus />
                <span className="hidden @md/header:inline">New Story</span>
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => openSettings(board.id, "stages")}
                    aria-label="Board Settings"
                  >
                    <Settings />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Board Settings</TooltipContent>
              </Tooltip>
            </>
          )}
        </header>

        {/* relative: absolutely positioned descendants (such as the hidden checkbox a Radix Switch adds inside a
            form) overflow this scroller, not SidebarInset, so they cannot stretch the document under the footer. */}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-auto">
          {failure && <ErrorBanner message={failure} onDismiss={() => setFailure(null)} />}

          {view.kind === "project-settings" && project ? (
            <ModelSettings key={JSON.stringify(project.config)} project={project.config} act={act} />
          ) : !board ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
              <p className="text-muted-foreground">No Boards yet. Create a Board to get started.</p>
              <Button ref={emptyAction} onClick={openCreateBoard}>
                New Board
              </Button>
            </div>
          ) : settings ? (
            <BoardSettings
              project={project!.config}
              board={board}
              tab={settings.tab}
              onTab={(tab) => openSettings(board.id, tab)}
              act={act}
            />
          ) : (
            <BoardView
              board={board}
              runtime={project!.runtime}
              act={act}
              onOpenStory={(key) => navigate({ kind: "edit", key })}
              onCreateStory={openCreateStory}
              onOpenStages={() => openSettings(board.id, "stages")}
            />
          )}
        </div>

        <footer className="flex h-8 shrink-0 items-center gap-3 border-t px-3 text-xs whitespace-nowrap text-muted-foreground">
          {project && (
            <span className="shrink-0">
              Workers {Object.keys(project.runtime.claims).length}/{project.config.maxConcurrentWorkers}
              {project.runtime.queue.length > 0 && ` · ${project.runtime.queue.length} waiting`}
            </span>
          )}
          <span className="flex min-w-0 items-center gap-1.5" title={supervisorText}>
            <span
              className={cn("size-2 shrink-0 rounded-full", listening ? "bg-emerald-500" : "bg-muted-foreground/40")}
            />
            <span className="truncate">{supervisorText}</span>
          </span>
          <span className="ml-auto shrink-0">sf v{session.version}</span>
        </footer>

        {creating && (
          <CreateBoard
            onClose={() => setCreating(false)}
            onRestoreFocus={() => {
              const target = returnFocus.current;
              if (target?.isConnected) target.focus();
              else emptyAction.current?.focus();
            }}
            onCreated={(id) => {
              setCreating(false);
              openBoard(id);
            }}
          />
        )}
        {board && (route.kind === "create" || editingStory) && (
          <StoryEditor
            key={editingStory?.key ?? "new"}
            project={project!.config}
            board={board}
            story={editingStory ?? null}
            initialStage={editingStory ? undefined : createStage}
            act={act}
            onClose={closeStory}
          />
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <p className="grid min-h-svh place-items-center p-6 text-muted-foreground">{children}</p>;
}
