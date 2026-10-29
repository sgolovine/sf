import fs from "node:fs";
import { type ErrorResponse, routes, TOKEN_HEADER } from "#model/api";
import { SfError } from "../project/errors.ts";

/** `.sf/runtime/server.json`, written by `sf start`. `uiBase` is the Vite dev server. */
export type ServerInfo = { port: number; token: string; pid: number; uiBase?: string };

function readServerInfo(file: string): ServerInfo | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as ServerInfo;
  } catch {
    return null;
  }
}

/** The server described by `file`, if it answers. */
async function findServer(file: string): Promise<ServerInfo | null> {
  const s = readServerInfo(file);
  if (!s) return null;
  try {
    await api(s, "GET", routes.state);
    return s;
  } catch {
    return null;
  }
}

function uiUrl(server: ServerInfo) {
  return `${server.uiBase ?? `http://127.0.0.1:${server.port}`}/#authToken=${server.token}`;
}

/** Calls the sf API. Resolves to null on 204. sf rejections throw SfError. */
async function api<T>(server: ServerInfo, method: string, pathname: string, body?: unknown): Promise<T> {
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

export const ClientService = {
  readServerInfo,
  findServer,
  uiUrl,
  api,
};
