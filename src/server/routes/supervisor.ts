import { Router } from "express";
import type { PostMessageRequest } from "#model/api";
import type { Capabilities } from "#model/supervisor";
import type { Service } from "../project/service.ts";
import { StoreService, type Store } from "../services/StoreService.ts";

/** What the Supervisor reports about itself: its capabilities and messages for the UI. */
export function supervisorRouter(store: Store, service: Service) {
  const router = Router();

  router.post("/capabilities", async (req, res) => {
    StoreService.setCapabilities(store, req.body as Capabilities);
    // The Supervisor is back: run triggers that Workers queued while the server was down.
    if (service.hasProject()) await service.drainPending();
    res.json(store.state.supervisor);
  });

  router.post("/messages", (req, res) => {
    const body = req.body as PostMessageRequest;
    if (typeof body?.text !== "string" || !body.text.trim())
      return void res.status(400).json({ error: "text must be a non-empty string" });
    res.json(StoreService.addMessage(store, body));
  });

  return router;
}
