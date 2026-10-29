import { Router } from "express";
import type { ServerEvent } from "#model/session";
import { type Store, StoreService } from "../services/StoreService.ts";

/** Session state for the UI, file changes, and stopping the server. */
export function sessionRouter(store: Store, onStop: () => void) {
  const router = Router();

  router.get("/state", (_req, res) => {
    res.json(store.state);
  });

  router.get("/events", (req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    const send = () => {
      const event: ServerEvent = { type: "state", state: store.state };
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    send();
    const unsubscribe = StoreService.onState(store, send);
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  router.get("/files/changes", (req, res) => {
    const since = Number(req.query.since ?? 0);
    res.json({ changes: store.state.fileChanges.filter((c) => c.at > since) });
  });

  router.post("/stop", (_req, res) => {
    res.json({ ok: true });
    setTimeout(onStop, 50);
  });

  return router;
}
