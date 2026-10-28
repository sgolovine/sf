import { TOKEN_HEADER } from "@sf/protocol";

export type ServerInfo = { port: number; token: string; pid: number };

export function uiUrl(server: ServerInfo, base = `http://127.0.0.1:${server.port}`) {
  return `${base}/?t=${server.token}`;
}

/** Calls the sf-factory API. Resolves to null on 204. */
export async function api<T>(server: ServerInfo, method: string, pathname: string, body?: unknown): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${server.port}${pathname}`, {
    method,
    headers: { [TOKEN_HEADER]: server.token, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null as T;
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}
