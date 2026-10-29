import fs from "node:fs";
import path from "node:path";
import type { FileChange } from "@sf/protocol";

const IGNORED = new Set([".git", "node_modules", "dist", ".turbo", ".next", ".vite"]);
// Server churn under .sf/runtime that is not Project state.
const IGNORED_FILES = new Set([".sf/runtime/session.json", ".sf/runtime/server.json", ".sf/runtime/lock"]);
const FLUSH_MS = 200;

/** Watches `root` recursively and reports batched changes. Returns a stop function. */
export function watchFiles(root: string, onChanges: (changes: FileChange[]) => void): () => void {
  let pending = new Map<string, FileChange>();
  let timer: NodeJS.Timeout | undefined;

  const flush = () => {
    timer = undefined;
    const batch = [...pending.values()];
    pending = new Map();
    if (batch.length) onChanges(batch);
  };

  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(root, { recursive: true }, (event, filename) => {
      if (!filename) return;
      const rel = filename.toString().split(path.sep).join("/");
      if (rel.split("/").some((part) => IGNORED.has(part))) return;
      if (IGNORED_FILES.has(rel) || (rel.startsWith(".sf/") && rel.endsWith(".tmp"))) return;
      pending.set(rel, { path: rel, event, at: Date.now() });
      timer ??= setTimeout(flush, FLUSH_MS);
    });
  } catch (err) {
    console.error(`sf-factory: file watching disabled: ${(err as Error).message}`);
    return () => {};
  }
  watcher.on("error", (err) => console.error(`sf-factory: file watcher error: ${err.message}`));

  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
