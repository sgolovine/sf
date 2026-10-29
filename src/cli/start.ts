// `sf start`: runs the sf server (Express API + web interface) in the foreground
// of the calling process until Ctrl-C, SIGTERM or SIGHUP, `sf stop`, or the exit
// of the process that started it. Nothing is detached.

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCapabilities } from "../server/capabilities.ts";
import { findServer, readServerInfo, uiUrl, type ServerInfo } from "../server/client.ts";
import { atomicWrite } from "../server/project/fsutil.ts";
import { sfPaths } from "../server/project/paths.ts";
import { createService } from "../server/project/service.ts";
import { createApp, createOnlineService, listen, refreshProject } from "../server/server.ts";
import { Store } from "../server/store.ts";
import { watchFiles } from "../server/watcher.ts";
import type { Flags } from "./story.ts";

const SWEEP_MS = 60 * 1000;
const PARENT_CHECK_MS = 1000;

export async function runStart(flags: Flags, root: string, sf: string) {
  const paths = sfPaths(root);
  createService({ root, online: false }).init();
  const running = await findServer(paths.serverJson);
  if (running)
    throw new Error(`already running for ${root} at ${uiUrl(running)} (pid ${running.pid}). Stop it with \`sf stop\`.`);
  fs.rmSync(paths.serverJson, { force: true });

  const dev = Boolean(flags.dev);
  const token = str(flags.token) ?? crypto.randomBytes(16).toString("hex");
  const uiDir = dev ? null : findUiDir(str(flags["ui-dir"]) ?? process.env.SF_UI_DIR);
  if (!dev && !(uiDir && fs.existsSync(path.join(uiDir, "index.html")))) console.error("sf: No built UI found; run `pnpm build` (or `pnpm dev:web`)");

  const store = new Store(root, paths.sessionJson);
  const service = createOnlineService(store, { root, sf });
  const stopWatching = watchFiles(root, (changes) => {
    store.addFileChanges(changes);
    // Hand edits (and offline CLI writes) show up live; they never trigger Workers.
    if (changes.some((c) => c.path.startsWith(".sf/"))) refreshProject(store, service);
  });

  const app = createApp({ store, service, token, uiDir, onStop: () => shutdown("sf stop") });
  const port = Number(str(flags.port) ?? 0);
  let server: http.Server;
  try {
    server = await listen(app, port);
  } catch (err) {
    stopWatching();
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE")
      throw new Error(`port ${port} is already in use; pick another with --port, or omit it for a random port`);
    throw err;
  }
  const address = server.address();
  const info: ServerInfo = {
    port: typeof address === "object" && address ? address.port : 0,
    token,
    pid: process.pid,
    ...(dev ? { uiBase: "http://localhost:5173" } : {}),
  };
  atomicWrite(paths.serverJson, JSON.stringify(info));

  const sweep = setInterval(() => {
    if (service.hasProject()) service.sweep().catch((err) => console.error(`sf: sweep failed: ${err.message}`));
  }, SWEEP_MS);
  // The agent that ran `sf start` is the Supervisor. In dev there may be none.
  if (!dev) store.setCapabilities(resolveCapabilities(flags));
  // Run the triggers that Workers queued while no server was running.
  if (store.state.supervisor.capabilities && service.hasProject()) await service.drainPending();

  // Stop with the process that started sf (the agent's shell), even on SIGKILL.
  const parent = process.ppid;
  const parentCheck = setInterval(() => {
    if (process.ppid !== parent || !isAlive(parent)) shutdown("parent exited");
  }, PARENT_CHECK_MS);
  parentCheck.unref();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => shutdown(signal));

  let stopping = false;
  function shutdown(reason: string) {
    if (stopping) return;
    stopping = true;
    clearInterval(sweep);
    clearInterval(parentCheck);
    stopWatching();
    if (readServerInfo(paths.serverJson)?.pid === process.pid) fs.rmSync(paths.serverJson, { force: true });
    server.closeAllConnections();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
    // The terminal or pipe may be gone already.
    process.stdout.on("error", () => {});
    try {
      console.log(`sf stopped (${reason})`);
    } catch {
      // Nothing to report to.
    }
  }

  const url = uiUrl(info);
  console.log(`sf ready: ${url}`);
  if (dev) console.log(`api: http://127.0.0.1:${info.port}`);
  console.log(`project: ${root}`);
  console.log("Press Ctrl-C to stop.");
  if (flags.json) console.log(JSON.stringify({ url, port: info.port, pid: process.pid, supervisor: store.state.supervisor }));
  if (!flags["no-open"] && !process.env.SF_NO_OPEN) openBrowser(url);
}

/** True unless `pid` is gone. EPERM means it exists but belongs to someone else. */
export function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** The given UI directory, else dist/ui next to the bundle (dist/sf.mjs) or the source (src/cli). */
function findUiDir(given: string | undefined) {
  if (given) return given;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [path.join(here, "ui"), path.join(here, "../../dist/ui")].find((d) => fs.existsSync(path.join(d, "index.html"))) ?? null;
}

function openBrowser(target: string) {
  const [bin, args] =
    process.platform === "darwin"
      ? ["open", [target]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", target]]
        : ["xdg-open", [target]];
  try {
    spawn(bin, args, { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  } catch {
    // The URL is printed either way.
  }
}

function str(v: Flags[string] | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}
