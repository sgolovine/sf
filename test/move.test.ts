import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { setupProject, user, worker } from "./helpers.ts";

test("create and Move in Backlog/disabled Stages spawn nothing", async () => {
  const { svc, spawns, root } = await setupProject();
  const s1 = await svc.createStory("DEV", { title: "One" }, user);
  assert.equal(s1.key, "DEV-1");
  assert.equal(s1.stage, "backlog");
  assert.ok(fs.existsSync(path.join(root, ".sf/boards/development/stories/DEV-1.md")));
  assert.equal((await svc.createStory("development", { title: "Two" }, user)).key, "DEV-2");
  await svc.moveStory("DEV-1", "in_review", user);
  await svc.updateStage("DEV", "in_review", { promptEnabled: true, prompt: "   " });
  await svc.moveStory("DEV-2", "in_review", user);
  assert.equal(spawns.length, 0);
  await assert.rejects(svc.moveStory("DEV-2", "in_review", user), /already in/);
});

test("Move into an enabled Stage claims the Story and queues worker.spawn", async () => {
  const { svc, spawns } = await setupProject();
  await svc.createStory("DEV", { title: "One" }, user);
  const moved = await svc.moveStory("DEV-1", "todo", user);
  assert.equal(spawns.length, 1);
  const spawn = spawns[0]!;
  assert.equal(spawn.storyKey, "DEV-1");
  assert.equal(spawn.mode, "thread");
  assert.equal(spawn.worktree.branch, "sf/DEV-1");
  assert.ok(spawn.brief.indexOf("Plan the Story.") < spawn.brief.indexOf("### DEV-1: One"));
  // The command is published after the reservation is saved, so only the saved Claim has its id.
  const claim = svc.snapshot()!.runtime.claims["DEV-1"]!;
  assert.deepEqual(
    { worker: moved.claim?.workerId, status: moved.claim?.status, command: claim.commandId },
    { worker: spawn.workerId, status: "spawning", command: "c1" },
  );
  assert.equal(spawn.execution?.id, claim.executionId);
});

test("creating a Story in an enabled Stage counts as a Move", async () => {
  const { svc, spawns } = await setupProject();
  const s = await svc.createStory("DEV", { title: "X", stage: "todo" }, user);
  assert.equal(spawns.length, 1);
  assert.ok(s.claim);
});

test("Claims block other Moves; the claiming Worker's Move ends it and triggers the next Stage", async () => {
  const { svc, spawns } = await setupProject();
  await svc.createStory("DEV", { title: "One", stage: "todo" }, user);
  const w1 = spawns[0]!.workerId;
  await assert.rejects(svc.moveStory("DEV-1", "in_review", user), {
    code: "claimed",
    message: `DEV-1 is claimed by Worker ${w1}`,
  });
  const moved = await svc.moveStory("DEV-1", "in_progress", worker(w1));
  assert.equal(spawns.length, 2);
  assert.notEqual(moved.claim?.workerId, w1);
  assert.equal(moved.claim?.stageId, "in_progress");
  await assert.rejects(svc.moveStory("DEV-1", "in_review", worker(w1)), {
    code: "claim_gone",
    message: "claim is gone",
  });
});

test("at the cap spawns queue FIFO, a new Move replaces the entry, freed slots go oldest first", async () => {
  const { svc, spawns } = await setupProject({ config: { maxConcurrentWorkers: 1 } });
  for (const t of ["A", "B", "C"]) await svc.createStory("DEV", { title: t }, user);
  await svc.moveStory("DEV-1", "todo", user);
  const b = await svc.moveStory("DEV-2", "todo", user);
  assert.equal(b.queued, true);
  assert.equal(b.claim, undefined);
  await svc.moveStory("DEV-3", "todo", user);
  // DEV-2 moves again: its queued spawn is replaced and goes to the back.
  await svc.moveStory("DEV-2", "in_progress", user);
  const queue = () => svc.snapshot()!.runtime.queue.map((q) => `${q.storyKey}:${q.stageId}`);
  assert.deepEqual(queue(), ["DEV-3:todo", "DEV-2:in_progress"]);
  // The Worker on DEV-1 moves it on: DEV-3 (oldest) gets the slot and DEV-1 queues behind.
  await svc.moveStory("DEV-1", "in_progress", worker(spawns[0]!.workerId));
  assert.equal(spawns.at(-1)!.storyKey, "DEV-3");
  assert.deepEqual(queue(), ["DEV-2:in_progress", "DEV-1:in_progress"]);
  // Moving a queued Story out of the Stage drops it when the queue drains.
  await svc.moveStory("DEV-2", "backlog", user);
  await svc.forceRelease("DEV-3");
  assert.equal(spawns.at(-1)!.storyKey, "DEV-1");
  assert.deepEqual(queue(), []);
});

test("Backlog and Done cannot be renamed, moved, removed, or prompted", async () => {
  const { svc } = await setupProject();
  for (const id of ["backlog", "done"]) {
    await assert.rejects(svc.updateStage("DEV", id, { name: "X" }), { code: "invalid" });
    await assert.rejects(svc.updateStage("DEV", id, { promptEnabled: true }), { code: "invalid" });
    await assert.rejects(svc.updateStage("DEV", id, { prompt: "do it" }), { code: "invalid" });
    await assert.rejects(svc.reorderStage("DEV", id, 2), { code: "invalid" });
    await assert.rejects(svc.removeStage("DEV", id), { code: "invalid" });
  }
  await assert.rejects(svc.reorderStage("DEV", "todo", 0), { code: "invalid" });
});

test("Stage add/rename/reorder/remove", async () => {
  const { svc, root } = await setupProject();
  const added = await svc.addStage("DEV", "In Fixup", "in_review");
  assert.equal(added.id, "in_fixup");
  await svc.updateStage("DEV", "in_review", { name: "Review" });
  await svc.reorderStage("DEV", "in_fixup", 1);
  const board = svc.showBoard("DEV");
  assert.deepEqual(
    board.config.stages.map((s) => `${s.id}:${s.name}`),
    ["backlog:Backlog", "in_fixup:In Fixup", "todo:TODO", "in_progress:In Progress", "in_review:Review", "done:Done"],
  );
  assert.equal(fs.readFileSync(path.join(root, ".sf/boards/development/stages/todo.md"), "utf8"), "Plan the Story.");
  await svc.createStory("DEV", { title: "x", stage: "in_fixup" }, user);
  await assert.rejects(svc.removeStage("DEV", "in_fixup"), /still holds DEV-1/);
  await svc.moveStory("DEV-1", "backlog", user);
  await svc.removeStage("DEV", "in_fixup");
});

test("a failed spawn flags the Story; retry respawns; a Move clears the failure", async () => {
  const { svc, spawns } = await setupProject();
  await svc.createStory("DEV", { title: "One", stage: "todo" }, user);
  await svc.spawnResult(spawns[0]!.workerId, false, "no thread tool");
  let [s] = svc.listStories("DEV");
  assert.equal(s!.stage, "todo");
  assert.equal(s!.claim, undefined);
  assert.equal(s!.failure?.error, "no thread tool");
  await svc.retry("DEV-1");
  assert.equal(spawns.length, 2);
  await svc.spawnResult(spawns[1]!.workerId, true, "thread-9");
  [s] = svc.listStories("DEV");
  assert.equal(s!.claim?.status, "active");
  assert.equal(svc.snapshot()!.runtime.workers[spawns[1]!.workerId]!.threadId, "thread-9");
  await svc.forceRelease("DEV-1");
  await svc.moveStory("DEV-1", "in_review", user);
  await assert.rejects(svc.retry("DEV-1"), /no failed spawn/);
});

test("force-release while spawning cancels the spawn", async () => {
  const { svc, spawns } = await setupProject();
  await svc.createStory("DEV", { title: "One", stage: "todo" }, user);
  await svc.forceRelease("DEV-1");
  assert.deepEqual(await svc.prepareSpawn(spawns[0]!.workerId), { cancelled: true });
});

test("custom fields are validated on create and update", async () => {
  const { svc } = await setupProject();
  await svc.updateBoard("DEV", {
    schema: [{ id: "priority", name: "Priority", type: "single-select", options: ["low", "high"] }],
  });
  await assert.rejects(svc.createStory("DEV", { title: "x", fields: { priority: "mid" } }, user), { code: "invalid" });
  await svc.createStory("DEV", { title: "x", fields: { priority: "low" } }, user);
  const s = await svc.updateStory("DEV-1", { fields: { priority: "high" }, body: "Body" }, user);
  assert.deepEqual(s.fields, { priority: "high" });
  assert.equal(s.body, "Body");
  await assert.rejects(svc.updateBoard("DEV", { overrides: { maxConcurrentWorkers: 2 } as never }), /Project-wide/);
});
