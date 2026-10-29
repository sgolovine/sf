import { useState, type ReactNode } from "react";
import type { BoardSnapshot, FieldDef, StoryView } from "@sf/protocol";
import { sfApi } from "../api/client.ts";
import type { Act } from "./ErrorBanner.tsx";

type Props = { board: BoardSnapshot; story: StoryView | null; act: Act; onClose: () => void };

/** Create or edit a Story. Custom field inputs follow the Board's Story schema. */
export function StoryEditor({ board, story, act, onClose }: Props) {
  const [title, setTitle] = useState(story?.title ?? "");
  const [stage, setStage] = useState("backlog");
  const [body, setBody] = useState(story?.body ?? "");
  const [fields, setFields] = useState<Record<string, unknown>>(story?.fields ?? {});
  const schema = board.config.schema;

  const save = async () => {
    // Send every schema field; null clears it on the server.
    const values = Object.fromEntries(schema.map((f) => [f.id, fields[f.id] ?? null]));
    const ok = story
      ? await act(() => sfApi.updateStory(story.key, { title, body, fields: values }))
      : await act(() => sfApi.createStory({ board: board.id, title, stage, body, fields: values }));
    if (ok) onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal panel"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2>{story ? `${story.key}` : `New Story on ${board.config.name}`}</h2>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>
        {story ? (
          <p className="muted">
            Stage: {board.config.stages.find((s) => s.id === story.stage)?.name ?? story.stage}
            {story.branch && ` · branch ${story.branch}`}
          </p>
        ) : (
          <label>
            Stage
            <select value={stage} onChange={(e) => setStage(e.target.value)}>
              {board.config.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {schema.map((f) => (
          <FieldInput key={f.id} field={f} value={fields[f.id]} onChange={(v) => setFields({ ...fields, [f.id]: v })} />
        ))}
        <label>
          Description
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} />
        </label>
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!title.trim()}>
            {story ? "Save" : "Create Story"}
          </button>
        </div>
      </form>
    </div>
  );
}

function FieldInput({ field, value, onChange }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const label = (input: ReactNode) => (
    <label>
      {field.name}
      {input}
    </label>
  );
  switch (field.type) {
    case "number":
      return label(
        <input
          type="number"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />,
      );
    case "boolean":
      return (
        <label className="inline">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} /> {field.name}
        </label>
      );
    case "date":
      return label(<input type="date" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || null)} />);
    case "single-select":
      return label(
        <select value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {field.options?.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>,
      );
    case "multi-select": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <fieldset>
          <legend>{field.name}</legend>
          {field.options?.map((o) => (
            <label key={o} className="inline">
              <input
                type="checkbox"
                checked={selected.includes(o)}
                onChange={(e) => {
                  const next = e.target.checked ? [...selected, o] : selected.filter((x) => x !== o);
                  onChange(next.length ? next : null);
                }}
              />{" "}
              {o}
            </label>
          ))}
        </fieldset>
      );
    }
    default:
      return label(<input value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || null)} />);
  }
}
