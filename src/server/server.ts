import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import {
  routes,
  TOKEN_HEADER,
  validateCommand,
  type AddStageRequest,
  type Capabilities,
  type CommandRecord,
  type CommandResultRequest,
  type CreateBoardRequest,
  type CreateStoryRequest,
  type EnqueueCommandRequest,
  type MoveStoryRequest,
  type PostMessageRequest,
  type ReleaseStoryRequest,
  type ReorderStageRequest,
  type ServerEvent,
  type UpdateBoardRequest,
  type UpdateStageRequest,
  type UpdateStoryRequest,
  type WorktreeRequest,
} from "#protocol";
import { HTTP_STATUS, SfError } from "./project/errors.ts";
import { createService, type Actor, type Service, type ServiceOptions } from "./project/service.ts";
import type { Store } from "./store.ts";

const MAX_WAIT_SECONDS = 60;

export type ServerOptions = {
  store: Store;
  service: Service;
  token: string;
  /** Built UI directory. When missing (dev), run the Vite dev server instead. */
  uiDir: string | null;
  onRequest: () => void;
  onStop: () => void;
};

/**
 * The online Story service: spawns become `worker.spawn` commands in the Store,
 * and every change refreshes the Project snapshot the UI sees.
 */
export function createOnlineService(store: Store, options: Pick<ServiceOptions, "root" | "sf" | "git" | "now">) {
  const service = createService({
    ...options,
    online: true,
    onSpawn: (request) => store.enqueue({ type: "worker.spawn", ...request }).id,
    spawnMode: () => (store.state.supervisor.capabilities?.canSpawnThreads ? "thread" : "subagent"),
    onChange: () => refreshProject(store, service),
  });
  refreshProject(store, service);
  return service;
}

export function refreshProject(store: Store, service: Service) {
  try {
    store.setProject(service.snapshot());
  } catch (err) {
    // A hand edit can leave a file unreadable; keep the last good snapshot.
    console.error(`sf: cannot read the Project: ${(err as Error).message}`);
  }
}

export function createApp({ store, service, token, uiDir, onRequest, onStop }: ServerOptions) {
  const app = express();
  app.use((_req, _res, next) => {
    onRequest();
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    const given = req.get(TOKEN_HEADER);
    if (given !== token) return void res.status(403).json({ error: "bad token" });
    next();
  });

  app.get(routes.state, (_req, res) => {
    res.json(store.state);
  });

  app.get(routes.events, (req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    const send = () => {
      const event: ServerEvent = { type: "state", state: store.state };
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    send();
    store.on("state", send);
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(ping);
      store.off("state", send);
    });
  });

  // UI → Supervisor: enqueue an instruction.
  app.post(routes.commands, (req, res) => {
    const { command } = (req.body ?? {}) as Partial<EnqueueCommandRequest>;
    const error = validateCommand(command);
    if (error) return void res.status(400).json({ error });
    res.json(store.enqueue(command!));
  });

  /**
   * Claims the next command. A `worker.spawn` first gets its Story Worktree;
   * one whose Claim is gone is cancelled, and one whose worktree fails is failed.
   */
  async function claimNext(): Promise<CommandRecord | null> {
    for (;;) {
      const record = store.claim();
      if (!record || record.command.type !== "worker.spawn") return record;
      const { workerId } = record.command;
      const prepared = await service.prepareSpawn(workerId);
      if ("ok" in prepared) return record;
      if ("cancelled" in prepared) {
        store.cancel(record.id);
        continue;
      }
      store.finish(record.id, { ok: false, error: prepared.error });
      await service.spawnResult(workerId, false, prepared.error);
    }
  }

  // Supervisor: long-poll for the next command. 204 when nothing arrived in time.
  app.get(routes.nextCommand, async (req, res) => {
    const waitSeconds = Math.min(Number(req.query.wait ?? 25) || 0, MAX_WAIT_SECONDS);
    const deadline = Date.now() + waitSeconds * 1000;
    let closed = false;
    res.on("close", () => {
      closed = true;
    });
    const unlisten = store.listen();
    try {
      while (!closed) {
        const record = await claimNext();
        if (record) return void res.json(record);
        const remaining = deadline - Date.now();
        if (remaining <= 0) return void res.status(204).end();
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            store.off("command", done);
            res.off("close", done);
            resolve();
          };
          const timer = setTimeout(done, remaining);
          store.on("command", done);
          res.on("close", done);
        });
      }
    } finally {
      unlisten();
    }
  });

  app.post("/api/commands/:id/result", async (req, res) => {
    const body = req.body as CommandResultRequest;
    if (typeof body?.ok !== "boolean") return void res.status(400).json({ error: "body.ok must be a boolean" });
    const before = store.state.commands.find((c) => c.id === req.params.id)?.status;
    const record = store.finish(String(req.params.id), body);
    if (!record) return void res.status(404).json({ error: "no such command" });
    if (record.command.type === "worker.spawn" && before !== "cancelled")
      await service.spawnResult(record.command.workerId, body.ok, body.ok ? body.result : body.error);
    res.json(record);
  });

  app.post(routes.capabilities, async (req, res) => {
    store.setCapabilities(req.body as Capabilities);
    // The Supervisor is back: run triggers that Workers queued while the server was down.
    if (service.hasProject()) await service.drainPending();
    res.json(store.state.supervisor);
  });

  app.post(routes.messages, (req, res) => {
    const body = req.body as PostMessageRequest;
    if (typeof body?.text !== "string" || !body.text.trim())
      return void res.status(400).json({ error: "text must be a non-empty string" });
    res.json(store.addMessage(body));
  });

  app.get(routes.fileChanges, (req, res) => {
    const since = Number(req.query.since ?? 0);
    res.json({ changes: store.state.fileChanges.filter((c) => c.at > since) });
  });

  app.post(routes.stop, (_req, res) => {
    res.json({ ok: true });
    setTimeout(onStop, 50);
  });

  // ---------- Project ----------

  const actor = (worker: unknown): Actor => (typeof worker === "string" && worker ? { kind: "worker", id: worker } : { kind: "user" });
  const param = (req: Request, name: string) => String(req.params[name]);

  app.get(routes.project, (_req, res) => {
    res.json(service.snapshot());
  });

  app.post(routes.projectInit, (_req, res) => {
    const config = service.init();
    refreshProject(store, service);
    res.json(config);
  });

  app.post(routes.boards, async (req, res) => {
    const { name, key } = req.body as CreateBoardRequest;
    if (typeof name !== "string" || typeof key !== "string") throw new SfError("invalid", "name and key are required");
    res.json(await service.createBoard(name, key));
  });

  app.get("/api/boards/:board", (req, res) => {
    res.json(service.showBoard(param(req, "board")));
  });

  app.patch("/api/boards/:board", async (req, res) => {
    res.json(await service.updateBoard(param(req, "board"), req.body as UpdateBoardRequest));
  });

  app.post("/api/boards/:board/stages", async (req, res) => {
    const { name, after } = req.body as AddStageRequest;
    if (typeof name !== "string") throw new SfError("invalid", "name is required");
    res.json(await service.addStage(param(req, "board"), name, after));
  });

  app.patch("/api/boards/:board/stages/:stage", async (req, res) => {
    res.json(await service.updateStage(param(req, "board"), param(req, "stage"), req.body as UpdateStageRequest));
  });

  app.post("/api/boards/:board/stages/:stage/reorder", async (req, res) => {
    const { index } = req.body as ReorderStageRequest;
    res.json(await service.reorderStage(param(req, "board"), param(req, "stage"), Number(index)));
  });

  app.delete("/api/boards/:board/stages/:stage", async (req, res) => {
    res.json(await service.removeStage(param(req, "board"), param(req, "stage")));
  });

  app.get(routes.stories, (req, res) => {
    const { board, stage } = req.query;
    res.json(service.listStories(typeof board === "string" ? board : undefined, typeof stage === "string" ? stage : undefined));
  });

  app.post(routes.stories, async (req, res) => {
    const { board, worker, ...input } = req.body as CreateStoryRequest;
    if (typeof board !== "string") throw new SfError("invalid", "board is required");
    res.json(await service.createStory(board, input, actor(worker)));
  });

  app.get("/api/stories/:key", async (req, res) => {
    res.json(await service.showStory(param(req, "key"), actor(req.query.worker)));
  });

  app.patch("/api/stories/:key", async (req, res) => {
    const { worker, ...patch } = req.body as UpdateStoryRequest;
    res.json(await service.updateStory(param(req, "key"), patch, actor(worker)));
  });

  app.post("/api/stories/:key/move", async (req, res) => {
    const { stage, worker } = req.body as MoveStoryRequest;
    if (typeof stage !== "string") throw new SfError("invalid", "stage is required");
    res.json(await service.moveStory(param(req, "key"), stage, actor(worker)));
  });

  app.post("/api/stories/:key/release", async (req, res) => {
    res.json(await service.releaseStory(param(req, "key"), actor((req.body as ReleaseStoryRequest)?.worker)));
  });

  app.post("/api/stories/:key/force-release", async (req, res) => {
    res.json(await service.forceRelease(param(req, "key")));
  });

  app.post("/api/stories/:key/retry", async (req, res) => {
    res.json(await service.retry(param(req, "key")));
  });

  app.post("/api/stories/:key/worktree", async (req, res) => {
    const { action, force } = req.body as WorktreeRequest;
    const key = param(req, "key");
    if (action === "ensure") return void res.json(await service.ensureStoryWorktree(key));
    if (action === "remove") return void res.json(await service.removeWorktree(key, Boolean(force)));
    throw new SfError("invalid", 'action must be "ensure" or "remove"');
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  app.use("/api", (err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SfError) return void res.status(HTTP_STATUS[err.code]).json({ error: err.message, code: err.code });
    res.status(err.status ?? 500).json({ error: err.message });
  });

  if (uiDir && fs.existsSync(path.join(uiDir, "index.html"))) {
    app.use(express.static(uiDir, { index: false }));
    app.get("/{*path}", (_req, res) => {
      res.set("cache-control", "no-store").sendFile("index.html", { root: uiDir });
    });
  } else {
    app.get("/", (_req, res) => {
      res.type("text").send("sf API is running. No built UI found; run `pnpm build` (or `pnpm dev:web`).");
    });
  }

  return app;
}

export function listen(app: express.Express, port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve(server)));
  });
}
