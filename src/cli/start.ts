// `sf start`: runs the sf server (Express API + web interface) in the foreground
// of the calling process until Ctrl-C, SIGTERM or SIGHUP, `sf stop`, or the exit
// (or orphaning) of the process that started it. Nothing is detached.

import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWrite } from "../server/project/fsutil.ts";
import { sfPaths } from "../server/project/paths.ts";
import { createService } from "../server/project/service.ts";
import { createApp, listen } from "../server/server.ts";
import { CapabilitiesService } from "../server/services/CapabilitiesService.ts";
import { ClientService, type ServerInfo } from "../server/services/ClientService.ts";
import { OnlineService } from "../server/services/OnlineService.ts";
import { StoreService } from "../server/services/StoreService.ts";
import { WatcherService } from "../server/services/WatcherService.ts";
import type { Flags } from "./story.ts";

const SWEEP_MS = 60 * 1000;
const CONFIG_FILE = /^\.sf\/(sf\.config\.json|boards\/[^/]+\/board\.config\.json)$/;
// ps is a process per check, so poll less often where there is no /proc.
const PARENT_CHECK_MS = process.platform === "linux" ? 1000 : 3000;

export async function runStart(flags: Flags, root: string, sf: string) {
  const paths = sfPaths(root);
  createService({ root, online: false }).init();
  const running = await ClientService.findServer(paths.serverJson);
  if (running)
    throw new Error(
      `already running for ${root} at ${ClientService.uiUrl(running)} (pid ${running.pid}). Stop it with \`sf stop\`.`,
    );
  fs.rmSync(paths.serverJson, { force: true });

  const dev = Boolean(flags.dev);
  const token = str(flags.token) ?? crypto.randomBytes(16).toString("hex");
  const uiDir = dev ? null : findUiDir(str(flags["ui-dir"]) ?? process.env.SF_UI_DIR);
  if (!dev && !(uiDir && fs.existsSync(path.join(uiDir, "index.html"))))
    console.error("sf: No built UI found; run `pnpm build` (or `pnpm dev:web`)");

  const store = StoreService.create(root, paths.sessionJson);
  const service = OnlineService.create(store, { root, sf });
  const stopWatching = WatcherService.watch(root, (changes) => {
    StoreService.addFileChanges(store, changes);
    // Hand edits (and offline CLI writes) show up live; they never trigger Workers.
    if (changes.some((c) => c.path.startsWith(".sf/"))) OnlineService.refreshProject(store, service);
    // Configuration edits can free or change capacity: drain the existing queue with them.
    if (changes.some((c) => CONFIG_FILE.test(c.path)) && service.hasProject())
      service.sweep().catch((err) => console.error(`sf: sweep failed: ${err.message}`));
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
  if (!dev) StoreService.setCapabilities(store, CapabilitiesService.resolve(flags));
  // Reconnect launches with their command records before anything new is dispatched.
  if (service.hasProject()) await service.recover();
  // Run the triggers that Workers queued while no server was running.
  if (store.state.supervisor.capabilities && service.hasProject()) await service.drainPending();

  // Stop with the process that started sf, even on SIGKILL. That is often a wrapper
  // shell that outlives a killed agent, so also stop when the wrapper is orphaned
  // (its own parent changes). Skip that when it was already a child of init.
  const parent = process.ppid;
  const grandparent = ppidOf(parent);
  const watchGrandparent = grandparent !== null && grandparent !== 1;
  const parentCheck = setInterval(() => {
    if (process.ppid !== parent || !isAlive(parent)) return shutdown("parent exited");
    const now = watchGrandparent ? ppidOf(parent) : null;
    if (now !== null && now !== grandparent) shutdown("parent orphaned");
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
    if (ClientService.readServerInfo(paths.serverJson)?.pid === process.pid)
      fs.rmSync(paths.serverJson, { force: true });
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

  const url = ClientService.uiUrl(info);
  console.log(`sf ready: ${url}`);
  if (dev) console.log(`api: http://127.0.0.1:${info.port}`);
  console.log(`project: ${root}`);
  console.log("Press Ctrl-C to stop.");
  if (flags.json)
    console.log(JSON.stringify({ url, port: info.port, pid: process.pid, supervisor: store.state.supervisor }));
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

/** The parent pid of `pid`, or null if it can't be read. */
export function ppidOf(pid: number): number | null {
  try {
    if (process.platform === "linux") {
      // Fields after "(comm)", which may itself contain spaces and parens: state ppid ...
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]) || null;
    }
    return (
      Number(
        execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim(),
      ) || null
    );
  } catch {
    return null;
  }
}

/** The given UI directory, else dist/ui next to the bundle (dist/sf.mjs) or the source (src/cli). */
function findUiDir(given: string | undefined) {
  if (given) return given;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return (
    [path.join(here, "ui"), path.join(here, "../../dist/ui")].find((d) => fs.existsSync(path.join(d, "index.html"))) ??
    null
  );
}

function openBrowser(target: string) {
  const [bin, args] =
    process.platform === "darwin"
      ? ["open", [target]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", target]]
        : ["xdg-open", [target]];
  try {
    spawn(bin, args, { detached: true, stdio: "ignore" })
      .on("error", () => {})
      .unref();
  } catch {
    // The URL is printed either way.
  }
}

function str(v: Flags[string] | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}
