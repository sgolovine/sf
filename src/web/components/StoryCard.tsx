import type { ReactNode } from "react";
import { activeHil, type BoardConfig } from "#model/config";
import type { StoryView } from "#model/project";
import type { RuntimeState } from "#model/runtime";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sfApi } from "../api/client.ts";
import type { Act } from "./ErrorBanner.tsx";

type Props = { story: StoryView; board: BoardConfig; runtime: RuntimeState; act: Act; onOpen: () => void };

export function StoryCard({ story, board, runtime, act, onOpen }: Props) {
  const claim = runtime.claims[story.key];
  const queued = runtime.queue.some((q) => q.storyKey === story.key);
  const failure = runtime.failures[story.key];
  const warning = runtime.worktreeWarnings[story.key];
  const hil = activeHil(board, story);
  return (
    <article
      className={cn(
        "flex cursor-grab flex-col gap-1.5 rounded-md border bg-card p-2 text-card-foreground shadow-xs",
        claim && "border-l-4 border-l-blue-500",
        hil && "border-l-4 border-l-amber-500",
        failure && "border-l-4 border-l-destructive",
      )}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/sf-story", story.key)}
    >
      <button type="button" className="cursor-pointer text-left text-sm hover:underline" onClick={onOpen}>
        <span className="text-xs text-muted-foreground">{story.key}</span> {story.title}
      </button>
      {hil && (
        <Status className="bg-amber-50 text-amber-900">
          <span className="font-semibold">Needs a human</span>
          {hil.comment && <span className="break-normal whitespace-pre-wrap">{hil.comment}</span>}
        </Status>
      )}
      {claim && (
        <Status className="bg-blue-50 text-blue-900">
          Worker {claim.workerId} · {claim.status} · {age(claim.claimedAt)}
          <Button size="xs" variant="outline" onClick={() => act(() => sfApi.forceRelease(story.key))}>
            Force release
          </Button>
        </Status>
      )}
      {queued && <Status className="bg-muted text-muted-foreground">waiting for a Worker</Status>}
      {failure && (
        <Status className="bg-red-50 text-destructive">
          Spawn failed: {failure.error}
          <Button size="xs" variant="outline" onClick={() => act(() => sfApi.retry(story.key))}>
            Retry
          </Button>
        </Status>
      )}
      {warning && (
        <Status className="bg-amber-50 text-amber-900">
          Worktree kept ({warning.reason}): {warning.path}
          <Button size="xs" variant="outline" onClick={() => act(() => sfApi.removeWorktree(story.key))}>
            Remove worktree
          </Button>
        </Status>
      )}
    </article>
  );
}

function Status({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 rounded-sm px-1.5 py-1 text-xs break-all", className)}>
      {children}
    </div>
  );
}

function age(since: number) {
  const minutes = Math.floor((Date.now() - since) / 60_000);
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
