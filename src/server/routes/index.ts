import express, { type NextFunction, type Request, type Response, Router } from "express";
import { TOKEN_HEADER } from "#model/api";
import { HTTP_STATUS, SfError } from "../project/errors.ts";
import type { Service } from "../project/service.ts";
import type { Store } from "../services/StoreService.ts";
import { boardsRouter } from "./boards.ts";
import { commandsRouter } from "./commands.ts";
import { executionsRouter } from "./executions.ts";
import { projectRouter } from "./project.ts";
import { sessionRouter } from "./session.ts";
import { storiesRouter } from "./stories.ts";
import { supervisorRouter } from "./supervisor.ts";

export type ApiOptions = { store: Store; service: Service; token: string; onStop: () => void };

/** Everything under `/api`: token check, the route groups, then 404 and error JSON. */
export function apiRouter({ store, service, token, onStop }: ApiOptions) {
  const router = Router();

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (req.get(TOKEN_HEADER) !== token) return void res.status(403).json({ error: "bad token" });
    next();
  });

  router.use("/stories", express.json({ limit: "60mb" }));
  router.use(express.json({ limit: "1mb" }));
  router.use(sessionRouter(store, onStop));
  router.use("/commands", commandsRouter(store, service));
  router.use("/supervisor", supervisorRouter(store, service));
  router.use("/project", projectRouter(store, service));
  router.use("/boards", boardsRouter(service));
  router.use("/stories", storiesRouter(service));
  router.use("/executions", executionsRouter(service));

  router.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  router.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SfError)
      return void res.status(HTTP_STATUS[err.code]).json({ error: err.message, code: err.code });
    res.status(err.status ?? 500).json({ error: err.message });
  });

  return router;
}
