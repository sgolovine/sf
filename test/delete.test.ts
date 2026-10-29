import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { loadBoard, saveBoard } from "../src/server/project/config.ts";
import { sfPaths } from "../src/server/project/paths.ts";
import { loadRuntime, saveRuntime } from "../src/server/project/runtime.ts";
import { createService } from "../src/server/project/service.ts";
import { storyBranch, worktreePath } from "../src/server/project/worktree.ts";
import { git, setupProject, tempRepo, user, worker } from "./helpers.ts";

test("deletion persists absence, preserves other Stories, and rejects repeated/missing deletion", async () => {
  const { svc, make } = await setupProject();
  await svc.createStory("DEV", { title: "Delete" }, user);
  await svc.createStory("DEV", { title: "Keep" }, user);
  assert.deepEqual(await svc.deleteStory("DEV-1", user), { key: "DEV-1" });
  assert.deepEqual(
    make(true)
      .listStories()
      .map((s) => s.key),
    ["DEV-2"],
  );
  for (const key of ["DEV-1", "DEV-99"]) await assert.rejects(svc.deleteStory(key, user), { code: "not_found" });
});

test("live Claims block deletion by users and their own Worker; expired/stale credentials are checked", async () => {
  const { svc, spawns, clock } = await setupProject();
  await svc.createStory("DEV", { title: "Claimed", stage: "todo" }, user);
  const actor = worker(spawns[0]!.workerId);
  for (const a of [user, actor]) await assert.rejects(svc.deleteStory("DEV-1", a), { code: "claimed" });
  await assert.rejects(svc.deleteStory("DEV-1", worker("stale")), { code: "claim_gone" });
  assert.equal(svc.listStories().length, 1);
  clock.advance(121 * 60_000);
  await assert.rejects(svc.deleteStory("DEV-1", actor), { code: "claim_gone" });
  await svc.deleteStory("DEV-1", user);
  assert.equal(svc.snapshot()!.runtime.workers[actor.id]!.endReason, "timeout");
});

test("deletion beats queue draining, removes all pending runtime entries, and keeps history/unrelated entries", async () => {
  const { svc, root, spawns, clock, make } = await setupProject({ config: { maxConcurrentWorkers: 1 } });
  await svc.createStory("DEV", { title: "Active", stage: "todo" }, user);
  const id = spawns[0]!.workerId;
  await svc.createStory("DEV", { title: "Queued", stage: "todo" }, user);
  const rt = loadRuntime(root);
  rt.pendingTriggers = [
    { type: "spawn", storyKey: "DEV-2", stageId: "todo", at: 1 },
    { type: "cleanup", storyKey: "DEV-2", at: 1 },
    { type: "spawn", storyKey: "DEV-1", stageId: "todo", at: 1 },
  ];
  rt.failures["DEV-2"] = rt.failures["DEV-1"] = { stageId: "todo", error: "failed", at: 1 };
  rt.worktreeWarnings["DEV-2"] = { path: "kept", branch: "kept", reason: "dirty", at: 1 };
  saveRuntime(root, rt);
  clock.advance(121 * 60_000);
  await svc.deleteStory("DEV-2", user);
  const after = loadRuntime(root);
  assert.deepEqual(after.queue, []);
  assert.deepEqual(
    after.pendingTriggers.map((t) => t.storyKey),
    ["DEV-1"],
  );
  assert.equal(after.failures["DEV-2"], undefined);
  assert.equal(after.worktreeWarnings["DEV-2"], undefined);
  assert.ok(after.failures["DEV-1"]);
  assert.ok(after.workers[id]);
  assert.equal(spawns.length, 1);
  // Even stale triggers restored after deletion cannot resurrect or spawn the Story.
  after.pendingTriggers = rt.pendingTriggers.filter((t) => t.storyKey === "DEV-2");
  after.queue = rt.queue;
  saveRuntime(root, after);
  await make(true).drainPending();
  assert.equal(spawns.length, 1);
  assert.equal(svc.listStories().length, 1);
});

test("offline deletion removes pending spawns and Done cleanup without touching git", async () => {
  const { svc, make, spawns } = await setupProject();
  const offline = make(false);
  await offline.createStory("DEV", { title: "Pending", stage: "todo" }, user);
  await offline.createStory("DEV", { title: "Done", stage: "done" }, user);
  await offline.deleteStory("DEV-1", user);
  await offline.deleteStory("DEV-2", user);
  assert.deepEqual(offline.snapshot()!.runtime.pendingTriggers, []);
  await svc.drainPending();
  assert.equal(spawns.length, 0);
  assert.deepEqual(svc.listStories(), []);
});

test("numbering survives highest/all deletion, service restart, runtime loss, old Boards, and concurrent allocation", async () => {
  const { root, svc, make } = await setupProject();
  await svc.createStory("DEV", { title: "One" }, user);
  await svc.createStory("DEV", { title: "Two" }, user);
  // Existing Board without a high-water mark, including an imported higher Story.
  const board = loadBoard(root, "development");
  delete board.storyNumber;
  saveBoard(root, "development", board);
  const dir = sfPaths(root).stories("development");
  fs.copyFileSync(path.join(dir, "DEV-2.md"), path.join(dir, "DEV-8.md"));
  await svc.deleteStory("DEV-8", user);
  assert.equal((await make(false).createStory("DEV", { title: "Nine" }, user)).key, "DEV-9");
  for (const s of svc.listStories()) await svc.deleteStory(s.key, user);
  fs.rmSync(path.dirname(sfPaths(root).stateJson), { recursive: true, force: true });
  const restarted = make(false);
  const allocated = await Promise.all(["Ten", "Eleven"].map((title) => restarted.createStory("DEV", { title }, user)));
  assert.deepEqual(
    allocated.map((s) => s.key),
    ["DEV-10", "DEV-11"],
  );
  await restarted.createBoard("Operations", "OPS");
  assert.equal((await restarted.createStory("OPS", { title: "Independent" }, user)).key, "OPS-1");
});

test("deletion retains the real Story Worktree and branch", async () => {
  const root = tempRepo();
  const svc = createService({ root, online: false });
  svc.init();
  await svc.createBoard("Development", "DEV");
  await svc.createStory("DEV", { title: "Keep code" }, user);
  await svc.ensureStoryWorktree("DEV-1");
  await svc.deleteStory("DEV-1", user);
  assert.ok(fs.existsSync(worktreePath(root, "DEV-1")));
  assert.equal(git(root, "branch", "--list", storyBranch("DEV-1")), "+ sf/DEV-1");
});

test("a deferred Done cleanup is harmless after deletion wins the mutation lock", async () => {
  const { svc, make, root } = await setupProject();
  const offline = make(false);
  await offline.createStory("DEV", { title: "Done", stage: "done" }, user);
  // drainPending queues its after-transaction cleanup behind this deletion.
  const draining = svc.drainPending();
  const deleting = svc.deleteStory("DEV-1", user);
  await Promise.all([draining, deleting]);
  assert.deepEqual(svc.listStories(), []);
  assert.deepEqual(loadRuntime(root).worktreeWarnings, {});
});
