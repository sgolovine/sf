import { useSession } from "./api/hooks.ts";

export function App() {
  const { data: session, error } = useSession();
  if (error) return <p>Could not reach the sf-factory server: {error.message}</p>;
  if (!session) return <p>Connecting…</p>;
  const { capabilities, listening } = session.supervisor;
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 720, margin: "2rem auto" }}>
      <h1>sf factory</h1>
      <p>
        Supervisor: {capabilities ? `${capabilities.agent} · ${capabilities.model} · ${capabilities.app}` : "not registered"}
        {" · "}
        {listening ? "listening" : "busy or away"}
      </p>
    </main>
  );
}
