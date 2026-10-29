import { Router } from "express";
import type { CommandResultRequest, EnqueueCommandRequest } from "#model/api";
import { type CommandRecord, validateCommand } from "#model/commands";
import type { Service } from "../project/service.ts";
import { type Store, StoreService } from "../services/StoreService.ts";

const MAX_WAIT_SECONDS = 60;

/** The command queue between the UI and the Supervisor. */
export function commandsRouter(store: Store, service: Service) {
  const router = Router();

  /**
   * Claims the next command. A `worker.spawn` first gets its Story Worktree;
   * one whose Claim is gone is cancelled, and one whose worktree fails is failed.
   */
  async function claimNext(): Promise<CommandRecord | null> {
    for (;;) {
      const record = StoreService.claim(store);
      if (record?.command.type !== "worker.spawn") return record;
      const { workerId } = record.command;
      const prepared = await service.prepareSpawn(workerId);
      if ("ok" in prepared) return record;
      if ("cancelled" in prepared) {
        StoreService.cancel(store, record.id);
        continue;
      }
      StoreService.finish(store, record.id, { ok: false, error: prepared.error });
      await service.spawnResult(workerId, false, prepared.error);
    }
  }

  // UI → Supervisor: enqueue an instruction.
  router.post("/", (req, res) => {
    const { command } = (req.body ?? {}) as Partial<EnqueueCommandRequest>;
    const error = validateCommand(command);
    if (error) return void res.status(400).json({ error });
    res.json(StoreService.enqueue(store, command!));
  });

  // Supervisor: long-poll for the next command. 204 when nothing arrived in time.
  router.get("/next", async (req, res) => {
    const waitSeconds = Math.min(Number(req.query.wait ?? 25) || 0, MAX_WAIT_SECONDS);
    const deadline = Date.now() + waitSeconds * 1000;
    let closed = false;
    res.on("close", () => {
      closed = true;
    });
    const unlisten = StoreService.listen(store);
    try {
      while (!closed) {
        const record = await claimNext();
        if (record) return void res.json(record);
        const remaining = deadline - Date.now();
        if (remaining <= 0) return void res.status(204).end();
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            unsubscribe();
            res.off("close", done);
            resolve();
          };
          const timer = setTimeout(done, remaining);
          const unsubscribe = StoreService.onCommand(store, done);
          res.on("close", done);
        });
      }
    } finally {
      unlisten();
    }
  });

  router.post("/:id/result", async (req, res) => {
    const body = req.body as CommandResultRequest;
    if (typeof body?.ok !== "boolean") return void res.status(400).json({ error: "body.ok must be a boolean" });
    const before = store.state.commands.find((c) => c.id === req.params.id)?.status;
    const record = StoreService.finish(store, req.params.id, body);
    if (!record) return void res.status(404).json({ error: "no such command" });
    if (record.command.type === "worker.spawn" && before !== "cancelled")
      await service.spawnResult(record.command.workerId, body.ok, body.ok ? body.result : body.error);
    res.json(record);
  });

  return router;
}
