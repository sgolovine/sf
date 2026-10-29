import { TOKEN_HEADER, type ErrorResponse } from "@sf/protocol";
import { SfError } from "./project/errors.ts";

export type ServerInfo = { port: number; token: string; pid: number };

export function uiUrl(server: ServerInfo, base = `http://127.0.0.1:${server.port}`) {
  return `${base}/#authToken=${server.token}`;
}

/** Calls the sf-factory API. Resolves to null on 204. sf rejections throw SfError. */
export async function api<T>(server: ServerInfo, method: string, pathname: string, body?: unknown): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${server.port}${pathname}`, {
    method,
    headers: { [TOKEN_HEADER]: server.token, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null as T;
  const json = (await res.json().catch(() => ({}))) as T & Partial<ErrorResponse>;
  if (!res.ok) {
    const message = json.error ?? `HTTP ${res.status}`;
    throw json.code ? new SfError(json.code, message) : new Error(message);
  }
  return json;
}
