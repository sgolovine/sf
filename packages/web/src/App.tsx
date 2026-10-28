import { useState } from "react";
import { useSession, useSpawnThread } from "./api/hooks.ts";

// Placeholder UI: the real interface is out of scope. It shows the host's
// status and exercises the spawn-thread helper end to end.
export function App() {
  const { data: session, error } = useSession();
  const spawnThread = useSpawnThread();
  const [prompt, setPrompt] = useState("");

  if (error) return <p>Could not reach the sf-factory server: {error.message}</p>;
  if (!session) return <p>Connecting…</p>;

  const { capabilities, listening } = session.host;
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 720, margin: "2rem auto" }}>
      <h1>sf factory</h1>
      <p>
        Host: {capabilities ? `${capabilities.agent} · ${capabilities.model} · ${capabilities.host}` : "not registered"}
        {" · "}
        {listening ? "listening" : "busy or away"}
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          spawnThread.mutate({ prompt }, { onSuccess: () => setPrompt("") });
        }}
      >
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} style={{ width: "100%" }} />
        <button type="submit" disabled={!prompt.trim() || spawnThread.isPending}>
          Spawn thread
        </button>
      </form>

      <h2>Commands</h2>
      <ul>
        {session.commands.map((c) => (
          <li key={c.id}>
            {c.id} {c.command.type} — {c.status}
            {c.result && `: ${c.result}`}
            {c.error && `: ${c.error}`}
          </li>
        ))}
      </ul>

      <h2>Messages</h2>
      <ul>
        {session.messages.map((m) => (
          <li key={m.id}>
            [{m.level}] {m.text}
          </li>
        ))}
      </ul>

      <h2>Recent file changes</h2>
      <ul>
        {session.fileChanges.slice(-10).map((f) => (
          <li key={`${f.path}-${f.at}`}>{f.path}</li>
        ))}
      </ul>
    </main>
  );
}
