import type { RuntimeState, StageConfig, StoryView } from "@sf/protocol";
import { sfApi } from "../api/client.ts";
import type { Act } from "./ErrorBanner.tsx";

type Props = { story: StoryView; stages: StageConfig[]; runtime: RuntimeState; act: Act; onOpen: () => void };

export function StoryCard({ story, stages, runtime, act, onOpen }: Props) {
  const claim = runtime.claims[story.key];
  const queued = runtime.queue.some((q) => q.storyKey === story.key);
  const failure = runtime.failures[story.key];
  const warning = runtime.worktreeWarnings[story.key];
  return (
    <article
      className={`card${claim ? " claimed" : ""}${failure ? " failed" : ""}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/sf-story", story.key)}
    >
      <button type="button" className="card-title" onClick={onOpen}>
        <span className="key">{story.key}</span> {story.title}
      </button>
      {claim && (
        <div className="badge claim">
          Worker {claim.workerId} · {claim.status} · {age(claim.claimedAt)}
          <button type="button" onClick={() => act(() => sfApi.forceRelease(story.key))}>
            Force release
          </button>
        </div>
      )}
      {queued && <div className="badge waiting">waiting for a Worker</div>}
      {failure && (
        <div className="badge failure">
          Spawn failed: {failure.error}
          <button type="button" onClick={() => act(() => sfApi.retry(story.key))}>
            Retry
          </button>
        </div>
      )}
      {warning && (
        <div className="badge warning">
          Worktree kept ({warning.reason}): {warning.path}
          <button type="button" onClick={() => act(() => sfApi.removeWorktree(story.key))}>
            Remove worktree
          </button>
        </div>
      )}
      <select
        className="move"
        value=""
        aria-label={`Move ${story.key}`}
        onChange={(e) => e.target.value && act(() => sfApi.moveStory(story.key, e.target.value))}
      >
        <option value="">Move to…</option>
        {stages
          .filter((s) => s.id !== story.stage)
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
      </select>
    </article>
  );
}

function age(since: number) {
  const minutes = Math.floor((Date.now() - since) / 60_000);
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
