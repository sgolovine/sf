import { Router } from "express";
import type { CommandResultRequest, EnqueueCommandRequest } from "#model/api";
import { type CommandRecord, validateCommand } from "#model/commands";
import { validateExecutionReport } from "#model/execution";
import type { Service } from "../project/service.ts";
import { type Store, StoreService } from "../services/StoreService.ts";

const MAX_WAIT_SECONDS = 60;

/** The command queue between the UI and the Supervisor. */
export function commandsRouter(store: Store, service: Service) {
  const router = Router();

  /**
   * Claims the next command. A `worker.spawn` first passes the delivery gate
   * (Story Worktree and a final check); one whose reservation ended is
   * cancelled, and one whose preparation fails is failed. Both never started.
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
      const execution = { status: "not-started" as const, evidence: prepared.error };
      await service.spawnResult(workerId, false, prepared.error, execution);
      StoreService.finish(store, record.id, { ok: false, error: prepared.error, execution });
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
        if (record && closed) {
          // Nothing was written to the Supervisor, so the command was never delivered.
          if (record.command.type === "worker.spawn") await service.undeliver(record.command.workerId);
          StoreService.unclaim(store, record.id);
          return;
        }
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
    const invalid = body.execution !== undefined && validateExecutionReport(body.execution);
    if (invalid) return void res.status(400).json({ error: invalid, code: "invalid" });
    const found = store.state.commands.find((c) => c.id === req.params.id);
    if (!found) return void res.status(404).json({ error: "no such command" });
    const { command } = found;
    const text = body.ok ? body.result : body.error;
    // Evidence is applied by launch generation first, even for cancelled or
    // interrupted records; a mismatched identity rejects without recording.
    const duplicate = found.status === "done" || found.status === "failed";
    if (command.type === "worker.spawn")
      await service.spawnResult(command.workerId, body.ok, text, body.execution, duplicate);
    else if (command.type === "execution.reconcile" || command.type === "execution.cancel")
      await service.attemptResult(command, body.ok, text, body.execution);
    res.json(StoreService.finish(store, req.params.id, body));
  });

  return router;
}
