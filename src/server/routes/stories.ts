import { Router } from "express";
import type {
  CreateStoryRequest,
  DeleteStoryRequest,
  MoveStoryRequest,
  ReleaseStoryRequest,
  UpdateStoryRequest,
  WaitStoryRequest,
  WorktreeRequest,
} from "#model/api";
import { SfError } from "../project/errors.ts";
import type { Actor, Service } from "../project/service.ts";

const actor = (worker: unknown): Actor =>
  typeof worker === "string" && worker ? { kind: "worker", id: worker } : { kind: "user" };

export function storiesRouter(service: Service) {
  const router = Router();

  router.get("/", (req, res) => {
    const { board, stage } = req.query;
    res.json(
      service.listStories(typeof board === "string" ? board : undefined, typeof stage === "string" ? stage : undefined),
    );
  });

  router.post("/", async (req, res) => {
    const { board, worker, ...input } = req.body as CreateStoryRequest;
    if (typeof board !== "string") throw new SfError("invalid", "board is required");
    res.json(await service.createStory(board, input, actor(worker)));
  });

  router.get("/:key/attachments", async (req, res) => {
    res.json(await service.listAttachments(req.params.key, actor(req.query.worker)));
  });
  router.post("/:key/attachments", async (req, res) => {
    const { worker, ...input } = req.body;
    res.json(await service.addAttachment(req.params.key, input, actor(worker)));
  });
  router.get("/:key/attachments/:id", async (req, res) => {
    const { metadata, bytes } = await service.getAttachment(req.params.key, req.params.id, actor(req.query.worker));
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(metadata.name)}`);
    res.send(bytes);
  });

  router.get("/:key", async (req, res) => {
    res.json(await service.showStory(req.params.key, actor(req.query.worker)));
  });

  router.delete("/:key", async (req, res) => {
    res.json(await service.deleteStory(req.params.key, actor((req.body as DeleteStoryRequest)?.worker)));
  });

  router.patch("/:key", async (req, res) => {
    const { worker, ...patch } = req.body as UpdateStoryRequest;
    res.json(await service.updateStory(req.params.key, patch, actor(worker)));
  });

  router.post("/:key/move", async (req, res) => {
    const { stage, worker } = req.body as MoveStoryRequest;
    if (typeof stage !== "string") throw new SfError("invalid", "stage is required");
    res.json(await service.moveStory(req.params.key, stage, actor(worker)));
  });

  router.post("/:key/wait", async (req, res) => {
    const { worker, dependsOn } = req.body as WaitStoryRequest;
    res.json(await service.waitStory(req.params.key, dependsOn, actor(worker)));
  });

  router.post("/:key/release", async (req, res) => {
    res.json(await service.releaseStory(req.params.key, actor((req.body as ReleaseStoryRequest)?.worker)));
  });

  router.post("/:key/force-release", async (req, res) => {
    res.json(await service.forceRelease(req.params.key));
  });

  router.post("/:key/retry", async (req, res) => {
    res.json(await service.retry(req.params.key));
  });

  router.post("/:key/worktree", async (req, res) => {
    const { action, force } = req.body as WorktreeRequest;
    const key = req.params.key;
    if (action === "ensure") return void res.json(await service.ensureStoryWorktree(key));
    if (action === "remove") return void res.json(await service.removeWorktree(key, Boolean(force)));
    throw new SfError("invalid", 'action must be "ensure" or "remove"');
  });

  return router;
}
