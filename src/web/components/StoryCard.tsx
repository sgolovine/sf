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
  const entry = runtime.queue.find((q) => q.storyKey === story.key);
  const busy = Object.values(runtime.executions ?? {}).find((e) => e.storyKey === story.key && e.status !== "terminal");
  // Claim ended, but sf has no evidence yet that the Worker's execution stopped.
  const windingDown = busy && claim?.workerId !== busy.workerId ? busy : undefined;
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
      {story.dependsOn?.length ? (
        <p className="text-xs text-muted-foreground">Depends on {story.dependsOn.join(", ")}</p>
      ) : null}
      {story.waitingOnDependencies && (
        <Status className="bg-muted text-muted-foreground">
          Waiting on dependencies: {story.unresolvedDependencies?.join(", ")}
        </Status>
      )}
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
      {windingDown && (
        <Status className="bg-muted text-muted-foreground">
          Previous Worker {windingDown.workerId} · {windingDown.status} · waiting for it to end
        </Status>
      )}
      {entry && (
        <Status className="bg-muted text-muted-foreground">
          {entry.wait?.reasons[0]?.code === "branch-occupied"
            ? "Waiting for the previous Worker to end"
            : entry.wait?.reasons.length && entry.wait.reasons.some((r) => r.code !== "capacity")
              ? `Waiting for a machine: ${entry.wait.reasons.map((r) => ("machineId" in r && r.machineId ? `${r.machineId} ${r.code}` : r.code)).join(", ")}`
              : "Waiting for Worker capacity"}
        </Status>
      )}
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
