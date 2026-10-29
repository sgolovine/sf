import { Router } from "express";
import type { AddStageRequest, CreateBoardRequest, ReorderStageRequest, UpdateBoardRequest, UpdateStageRequest } from "#model/api";
import { SfError } from "../project/errors.ts";
import type { Service } from "../project/service.ts";

/** Boards and their Stages. */
export function boardsRouter(service: Service) {
  const router = Router();

  router.post("/", async (req, res) => {
    const { name, key } = req.body as CreateBoardRequest;
    if (typeof name !== "string" || typeof key !== "string") throw new SfError("invalid", "name and key are required");
    res.json(await service.createBoard(name, key));
  });

  router.get("/:board", (req, res) => {
    res.json(service.showBoard(req.params.board));
  });

  router.patch("/:board", async (req, res) => {
    res.json(await service.updateBoard(req.params.board, req.body as UpdateBoardRequest));
  });

  router.post("/:board/stages", async (req, res) => {
    const { name, after } = req.body as AddStageRequest;
    if (typeof name !== "string") throw new SfError("invalid", "name is required");
    res.json(await service.addStage(req.params.board, name, after));
  });

  router.patch("/:board/stages/:stage", async (req, res) => {
    res.json(await service.updateStage(req.params.board, req.params.stage, req.body as UpdateStageRequest));
  });

  router.post("/:board/stages/:stage/reorder", async (req, res) => {
    const { index } = req.body as ReorderStageRequest;
    res.json(await service.reorderStage(req.params.board, req.params.stage, Number(index)));
  });

  router.delete("/:board/stages/:stage", async (req, res) => {
    res.json(await service.removeStage(req.params.board, req.params.stage));
  });

  return router;
}
