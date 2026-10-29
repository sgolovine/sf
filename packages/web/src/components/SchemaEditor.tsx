import { useState } from "react";
import { FIELD_TYPES, type BoardSnapshot, type FieldDef, type FieldType } from "@sf/protocol";
import { sfApi } from "../api/client.ts";
import type { Act } from "./ErrorBanner.tsx";

type Row = { id: string; name: string; type: FieldType; options: string };

/** Edits the Board's Story schema (custom fields). */
export function SchemaEditor({ board, act, onClose }: { board: BoardSnapshot; act: Act; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>(
    board.config.schema.map((f) => ({ id: f.id, name: f.name, type: f.type, options: (f.options ?? []).join(", ") })),
  );
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (i === j ? { ...r, ...patch } : r)));

  const save = async () => {
    const schema: FieldDef[] = rows.map((r) => ({
      id: r.id.trim(),
      name: r.name.trim(),
      type: r.type,
      ...(r.type.endsWith("select")
        ? {
            options: r.options
              .split(",")
              .map((o) => o.trim())
              .filter(Boolean),
          }
        : {}),
    }));
    if (await act(() => sfApi.updateBoard(board.id, { schema }))) onClose();
  };

  return (
    <aside className="drawer panel">
      <header className="drawer-header">
        <h2>Story fields: {board.config.name}</h2>
        <button type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      <table className="schema">
        <thead>
          <tr>
            <th>Id</th>
            <th>Name</th>
            <th>Type</th>
            <th>Options</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <input value={r.id} onChange={(e) => set(i, { id: e.target.value })} placeholder="priority" />
              </td>
              <td>
                <input value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Priority" />
              </td>
              <td>
                <select value={r.type} onChange={(e) => set(i, { type: e.target.value as FieldType })}>
                  {FIELD_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  value={r.options}
                  disabled={!r.type.endsWith("select")}
                  onChange={(e) => set(i, { options: e.target.value })}
                  placeholder="low, high"
                />
              </td>
              <td>
                <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove field">
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="actions">
        <button type="button" onClick={() => setRows([...rows, { id: "", name: "", type: "text", options: "" }])}>
          Add field
        </button>
        <button type="button" className="primary" onClick={() => void save()}>
          Save fields
        </button>
      </div>
    </aside>
  );
}
