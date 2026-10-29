import fs from "node:fs";
import path from "node:path";
import { shellQuote } from "../server/project/brief.ts";

export type SfCommandInput = {
  /** The running entry point: dist/sf.mjs, or src/cli/main.ts from source. */
  script: string;
  execPath: string;
  env: NodeJS.ProcessEnv;
  /** The first executable with this name on PATH, or null. */
  which: (bin: string) => string | null;
};

/**
 * The shell command that runs this sf, for Worker Briefs: $SF_COMMAND, else the
 * sf-dev launcher when running from source, else `sf` when PATH's `sf` is this
 * build (and not, say, the Salesforce CLI), else node and the absolute script.
 */
export function sfCommand({ script, execPath, env, which }: SfCommandInput): string {
  if (env.SF_COMMAND) return env.SF_COMMAND;
  if (script.endsWith(".ts")) return [execPath, path.join(path.dirname(script), "../../scripts/sf-dev.mjs")].map(shellQuote).join(" ");
  const onPath = which("sf");
  if (onPath && realpath(onPath) === realpath(script)) return "sf";
  return [execPath, script].map(shellQuote).join(" ");
}

/** Looks `bin` up on a PATH string. */
export function findOnPath(bin: string, pathEnv = ""): string | null {
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const file = path.join(dir, bin);
    try {
      fs.accessSync(file, fs.constants.X_OK);
      if (fs.statSync(file).isFile()) return file;
    } catch {
      // Not here.
    }
  }
  return null;
}

function realpath(file: string) {
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
}
