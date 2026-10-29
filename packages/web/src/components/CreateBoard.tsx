import { useState } from "react";
import { sfApi } from "../api/client.ts";
import type { Act } from "./ErrorBanner.tsx";

/** Creates a Board (and the Project, if needed) with the default Stages. */
export function CreateBoard({ act, onCreated, onCancel }: { act: Act; onCreated: (id: string) => void; onCancel?: () => void }) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  return (
    <form
      className="panel create-board"
      onSubmit={async (e) => {
        e.preventDefault();
        let id = "";
        if (await act(async () => (id = (await sfApi.createBoard(name, key)).id))) onCreated(id);
      }}
    >
      <h2>Create a Board</h2>
      <p className="muted">It starts with Backlog, TODO, In Progress, In Review, and Done.</p>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Development" autoFocus />
      </label>
      <label>
        Key
        <input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="DEV" />
      </label>
      <div className="actions">
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="primary" disabled={!name.trim() || !key.trim()}>
          Create Board
        </button>
      </div>
    </form>
  );
}
