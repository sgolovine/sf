import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldDef } from "#model/config";
import { setupProject, user, worker } from "./helpers.ts";

const schema: FieldDef[] = [
  { id: "plan_hil", name: "Plan HIL", type: "boolean" },
  { id: "plan_hil_comment", name: "Plan HIL comment", type: "text" },
  { id: "build_hil", name: "Build HIL", type: "boolean" },
];

/** setupProject plus HIL fields on `todo` (with a comment) and `in_progress` (flag only). */
async function setupHil(options: Parameters<typeof setupProject>[0] = {}) {
  const project = await setupProject(options);
  await project.svc.updateBoard("DEV", { schema });
  await project.svc.updateStage("DEV", "todo", { hilFlag: "plan_hil", hilComment: "plan_hil_comment" });
  await project.svc.updateStage("DEV", "in_progress", { hilFlag: "build_hil" });
  return project;
}

test("a Story held for HIL gets no Worker on a Move or create into the Stage", async () => {
  const { svc, spawns } = await setupHil();
  await svc.createStory("DEV", { title: "One", fields: { plan_hil: true, plan_hil_comment: "Which API?" } }, user);
  const moved = await svc.moveStory("DEV-1", "todo", user);
  const created = await svc.createStory("DEV", { title: "Two", stage: "todo", fields: { plan_hil: true } }, user);
  assert.equal(spawns.length, 0);
  assert.equal(moved.claim, undefined);
  assert.deepEqual(moved.hil, { flag: "plan_hil", comment: "Which API?" });
  assert.deepEqual(created.hil, { flag: "plan_hil" });
  // The flag of another Stage does not hold it.
  await svc.createStory("DEV", { title: "Three", stage: "todo", fields: { build_hil: true } }, user);
  assert.equal(spawns.length, 1);
});

test("clearing the HIL flag wakes the Story: a Worker spawns as on entering the Stage", async () => {
  const { svc, spawns } = await setupHil();
  await svc.createStory("DEV", { title: "One", stage: "todo", fields: { plan_hil: true } }, user);
  const woken = await svc.updateStory("DEV-1", { fields: { plan_hil: null, plan_hil_comment: "Use REST." } }, user);
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0]!.stageId, "todo");
  assert.equal(woken.claim?.workerId, spawns[0]!.workerId);
  assert.equal(woken.hil, undefined);
  // Setting it to false also wakes.
  await svc.createStory("DEV", { title: "Two", stage: "in_progress", fields: { build_hil: true } }, user);
  await svc.updateStory("DEV-2", { fields: { build_hil: false } }, user);
  assert.equal(spawns.length, 2);
  // Other updates do not spawn again.
  await svc.updateStory("DEV-2", { title: "Two again" }, user);
  assert.equal(spawns.length, 2);
});

test("a Worker sets HIL and releases; the human clears it and a new Worker starts", async () => {
  const { svc, spawns } = await setupHil();
  await svc.createStory("DEV", { title: "One", stage: "todo" }, user);
  const w1 = worker(spawns[0]!.workerId);
  await svc.updateStory("DEV-1", { fields: { plan_hil: true, plan_hil_comment: "Need a decision" } }, w1);
  await svc.releaseStory("DEV-1", w1);
  assert.equal(spawns.length, 1);
  await svc.updateStory("DEV-1", { fields: { plan_hil: false } }, user);
  assert.equal(spawns.length, 2);
});

test("no wake while the Story is claimed", async () => {
  const { svc, spawns } = await setupHil();
  await svc.createStory("DEV", { title: "One", stage: "todo" }, user);
  const w1 = worker(spawns[0]!.workerId);
  await svc.updateStory("DEV-1", { fields: { plan_hil: true } }, w1);
  await svc.updateStory("DEV-1", { fields: { plan_hil: false } }, w1);
  assert.equal(spawns.length, 1);
});

test("no wake when the Stage Prompt is disabled", async () => {
  const { svc, spawns } = await setupHil();
  await svc.createStory("DEV", { title: "One", stage: "todo", fields: { plan_hil: true } }, user);
  await svc.updateStage("DEV", "todo", { promptEnabled: false });
  await svc.updateStory("DEV-1", { fields: { plan_hil: false } }, user);
  assert.equal(spawns.length, 0);
});

test("no wake when the flag is cleared for another Stage", async () => {
  const { svc, spawns } = await setupHil();
  await svc.createStory("DEV", { title: "One", fields: { plan_hil: true, build_hil: true } }, user);
  await svc.moveStory("DEV-1", "in_progress", user);
  assert.equal(spawns.length, 0);
  await svc.updateStory("DEV-1", { fields: { plan_hil: false } }, user);
  assert.equal(spawns.length, 0);
  await svc.updateStory("DEV-1", { fields: { build_hil: false } }, user);
  assert.equal(spawns.length, 1);
});

test("a wake at the cap queues; setting the flag again drops the queued spawn", async () => {
  const { svc, spawns } = await setupHil({ config: { maxConcurrentWorkers: 1 } });
  await svc.createStory("DEV", { title: "Busy", stage: "in_progress" }, user);
  await svc.createStory("DEV", { title: "Held", stage: "todo", fields: { plan_hil: true } }, user);
  const woken = await svc.updateStory("DEV-2", { fields: { plan_hil: false } }, user);
  assert.equal(woken.queued, true);
  const held = await svc.updateStory("DEV-2", { fields: { plan_hil: true } }, user);
  assert.equal(held.queued, undefined);
  await svc.forceRelease("DEV-1");
  assert.equal(spawns.length, 1);
});

test("retry refuses a Story held for HIL", async () => {
  const { svc, spawns } = await setupHil();
  await svc.createStory("DEV", { title: "One", stage: "todo" }, user);
  await svc.spawnResult(spawns[0]!.workerId, false, "boom");
  await svc.updateStory("DEV-1", { fields: { plan_hil: true } }, user);
  await assert.rejects(svc.retry("DEV-1"), /held for HIL/);
  assert.equal(spawns.length, 1);
});

test("an offline clear queues a spawn trigger that the next start runs", async () => {
  const { svc, spawns, make } = await setupHil();
  await svc.createStory("DEV", { title: "One", stage: "todo", fields: { plan_hil: true } }, user);
  const offline = make(false);
  await offline.updateStory("DEV-1", { fields: { plan_hil: false } }, user);
  assert.deepEqual(
    offline.snapshot()!.runtime.pendingTriggers.map((t) => `${t.type}:${t.storyKey}:${t.stageId}`),
    ["spawn:DEV-1:todo"],
  );
  assert.equal(spawns.length, 0);
  await svc.drainPending();
  assert.equal(spawns.length, 1);
});

test("Stage HIL settings: set, partial update, clear, and validation", async () => {
  const { svc } = await setupHil();
  const stage = (id: string) => svc.showBoard("DEV").config.stages.find((s) => s.id === id)!;
  assert.deepEqual(stage("todo").hil, { flag: "plan_hil", comment: "plan_hil_comment" });
  await svc.updateStage("DEV", "todo", { hilComment: null });
  assert.deepEqual(stage("todo").hil, { flag: "plan_hil" });
  await svc.updateStage("DEV", "todo", { hilFlag: "" });
  assert.equal(stage("todo").hil, undefined);
  await assert.rejects(svc.updateStage("DEV", "todo", { hilComment: "plan_hil_comment" }), /needs a HIL flag/);
  await assert.rejects(svc.updateStage("DEV", "todo", { hilFlag: "plan_hil_comment" }), /must be a boolean field/);
  await assert.rejects(svc.updateStage("DEV", "todo", { hilFlag: "missing" }), /must be a boolean field/);
  await assert.rejects(
    svc.updateStage("DEV", "todo", { hilFlag: "plan_hil", hilComment: "build_hil" }),
    /must be a text field/,
  );
  await assert.rejects(svc.updateStage("DEV", "backlog", { hilFlag: "plan_hil" }), /cannot have HIL fields/);
  await assert.rejects(svc.updateStage("DEV", "done", { hilFlag: "plan_hil" }), /cannot have HIL fields/);
  // A schema change cannot drop a field a Stage uses for HIL.
  await assert.rejects(svc.updateBoard("DEV", { schema: schema.slice(0, 2) }), /must be a boolean field/);
});
