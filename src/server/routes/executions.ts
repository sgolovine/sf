import { Router } from "express";
import type { ExecutionReportRequest } from "#model/api";
import { validateExecutionReport } from "#model/execution";
import { SfError } from "../project/errors.ts";
import type { Service } from "../project/service.ts";

/** Execution diagnostics and recovery. Only correlated evidence can free an execution. */
export function executionsRouter(service: Service) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(service.executions());
  });

  router.get("/:id", (req, res) => {
    res.json(service.showExecution(req.params.id));
  });

  router.post("/:id/report", async (req, res) => {
    const body = req.body as ExecutionReportRequest;
    const invalid = validateExecutionReport(body);
    if (invalid) throw new SfError("invalid", invalid);
    res.json(await service.reportExecution(req.params.id, body));
  });

  router.post("/:id/reconcile", async (req, res) => {
    res.json(await service.requestReconcile(req.params.id));
  });

  router.post("/:id/cancel", async (req, res) => {
    res.json(await service.requestCancel(req.params.id));
  });

  return router;
}
