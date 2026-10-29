import fs from "node:fs";
import path from "node:path";
import { sfPaths } from "./paths.ts";

/** Writes through a temp file and a rename so readers never see a partial file. */
export function atomicWrite(file: string, data: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`cannot read ${file}: ${(err as Error).message}`);
  }
}

export function writeJson(file: string, value: unknown) {
  atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`);
}

const STALE_MS = 30_000;
const RETRY_MS = 50;
const WAIT_MS = 5_000;

// The lock file is shared by the server and offline CLIs, so it cannot tell two
// callers in one process apart. Calls in one process are chained here first.
let chain: Promise<unknown> = Promise.resolve();

/**
 * Runs `fn` while holding `.sf/runtime/lock` (an O_EXCL file with `{pid, at}`).
 * A lock is stale when its process is dead or it is older than 30 seconds.
 */
export function withLock<T>(root: string, fn: () => T | Promise<T>): Promise<T> {
  const run = chain.then(() => holdLock(root, fn));
  chain = run.catch(() => {});
  return run;
}

async function holdLock<T>(root: string, fn: () => T | Promise<T>): Promise<T> {
  const lock = sfPaths(root).lock;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try {
      fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: "wx" });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (isStale(lock)) {
        fs.rmSync(lock, { force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${lock}`);
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

function isStale(lock: string) {
  let holder: { pid?: number; at?: number };
  try {
    holder = JSON.parse(fs.readFileSync(lock, "utf8"));
  } catch {
    // Missing (just released) or half-written: retry rather than steal it.
    return false;
  }
  if (typeof holder.at !== "number" || Date.now() - holder.at > STALE_MS) return true;
  if (typeof holder.pid !== "number") return true;
  try {
    process.kill(holder.pid, 0);
    return false;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ESRCH";
  }
}
