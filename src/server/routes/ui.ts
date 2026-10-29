import fs from "node:fs";
import path from "node:path";
import express, { Router } from "express";

/** The built web interface, or a plain notice when there is none (dev). */
export function uiRouter(uiDir: string | null) {
  const router = Router();

  if (uiDir && fs.existsSync(path.join(uiDir, "index.html"))) {
    router.use(express.static(uiDir, { index: false }));
    router.get("/{*path}", (_req, res) => {
      res.set("cache-control", "no-store").sendFile("index.html", { root: uiDir });
    });
  } else {
    router.get("/", (_req, res) => {
      res.type("text").send("sf API is running. No built UI found; run `pnpm build` (or `pnpm dev:web`).");
    });
  }

  return router;
}
