import { Router } from "express";
import type { Service } from "../project/service.ts";

export function searchRouter(service: Service) {
  const router = Router();

  router.get("/", (req, res) => {
    const { q } = req.query;
    res.json(service.searchStories(typeof q === "string" ? q : ""));
  });

  return router;
}
