import { useState } from "react";
import type { BoardSnapshot } from "@sf/protocol";
import { sfApi } from "../api/client.ts";
import type { Act } from "./ErrorBanner.tsx";

type Props = { board: BoardSnapshot; stageId: string; act: Act; onClose: () => void };

/** Drawer for one Stage: name, Stage Prompt and its enabled flag, agent/model overrides, order, removal. */
export function StageSettings({ board, stageId, act, onClose }: Props) {
  const stages = board.config.stages;
  const index = stages.findIndex((s) => s.id === stageId);
  const stage = stages[index];
  const [name, setName] = useState(stage?.name ?? "");
  const [enabled, setEnabled] = useState(stage?.promptEnabled ?? false);
  const [prompt, setPrompt] = useState(board.prompts[stageId] ?? "");
  const [agent, setAgent] = useState(stage?.agent ?? "");
  const [model, setModel] = useState(stage?.model ?? "");
  if (!stage) return null;
  const fixed = stageId === "backlog" || stageId === "done";

  const save = async () => {
    const patch = fixed ? {} : { name, promptEnabled: enabled, prompt, agent: agent || null, model: model || null };
    if (await act(() => sfApi.updateStage(board.id, stageId, patch))) onClose();
  };

  return (
    <aside className="drawer panel">
      <header className="drawer-header">
        <h2>Stage: {stage.name}</h2>
        <button type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      <p className="muted">id: {stage.id}</p>
      {fixed ? (
        <p className="muted">{stage.name} is fixed: it cannot be renamed, moved, removed, or given a Stage Prompt.</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="inline">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Stage Prompt enabled
          </label>
          <label>
            Stage Prompt
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={12}
              placeholder="Instructions for the Worker that runs when a Story enters this Stage."
            />
          </label>
          <div className="row">
            <label>
              Agent override
              <input value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="Board/Project default" />
            </label>
            <label>
              Model override
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Board/Project default" />
            </label>
          </div>
          <div className="actions">
            <button type="button" disabled={index <= 1} onClick={() => act(() => sfApi.reorderStage(board.id, stageId, index - 1))}>
              ← Move left
            </button>
            <button
              type="button"
              disabled={index >= stages.length - 2}
              onClick={() => act(() => sfApi.reorderStage(board.id, stageId, index + 1))}
            >
              Move right →
            </button>
            <button
              type="button"
              className="danger"
              onClick={async () => {
                if (confirm(`Remove Stage ${stage.name}?`) && (await act(() => sfApi.removeStage(board.id, stageId)))) onClose();
              }}
            >
              Remove
            </button>
            <button type="submit" className="primary">
              Save
            </button>
          </div>
        </form>
      )}
    </aside>
  );
}
