import { Router } from "express";
import type { Service } from "../project/service.ts";
import { OnlineService } from "../services/OnlineService.ts";
import type { Store } from "../services/StoreService.ts";

export function projectRouter(store: Store, service: Service) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(service.snapshot());
  });

  router.get("/settings", (_req, res) => res.json(service.showProject()));
  router.patch("/settings", async (req, res) => res.json(await service.updateProject(req.body)));

  router.post("/init", (_req, res) => {
    const config = service.init();
    OnlineService.refreshProject(store, service);
    res.json(config);
  });

  return router;
}
