import { Router } from "express";
import { OnlineService } from "../services/OnlineService.ts";
import type { Service } from "../project/service.ts";
import type { Store } from "../services/StoreService.ts";

export function projectRouter(store: Store, service: Service) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(service.snapshot());
  });

  router.post("/init", (_req, res) => {
    const config = service.init();
    OnlineService.refreshProject(store, service);
    res.json(config);
  });

  return router;
}
