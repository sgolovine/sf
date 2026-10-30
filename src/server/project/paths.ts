import path from "node:path";

/** The Project root: `--project`, then `SF_PROJECT`, then the current directory. */
export function resolveProjectRoot(flag: string | undefined, env: NodeJS.ProcessEnv, cwd: string): string {
  return path.resolve(cwd, flag ?? env.SF_PROJECT ?? ".");
}

export function sfPaths(root: string) {
  const sf = path.join(root, ".sf");
  const boards = path.join(sf, "boards");
  const runtime = path.join(sf, "runtime");
  return {
    sf,
    config: path.join(sf, "sf.config.json"),
    gitignore: path.join(sf, ".gitignore"),
    boards,
    board: (id: string) => path.join(boards, id, "board.config.json"),
    stories: (id: string) => path.join(boards, id, "stories"),
    attachments: (id: string, key: string) => path.join(boards, id, "attachments", key),
    stages: (id: string) => path.join(boards, id, "stages"),
    runtime,
    serverJson: path.join(runtime, "server.json"),
    sessionJson: path.join(runtime, "session.json"),
    stateJson: path.join(runtime, "state.json"),
    lock: path.join(runtime, "lock"),
  };
}
