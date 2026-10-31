import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseStory, serializeStory } from "../src/server/project/story.ts";
import { setupProject, user, worker } from "./helpers.ts";

test("dependency lists persist through serialization, reload, unrelated edits and clearing", async () => {
  const { svc, make } = await setupProject();
  await svc.createStory("DEV", { title: "Prerequisite" }, user);
  await svc.createStory("DEV", { title: "Dependent", dependsOn: ["DEV-1"] }, user);
  await make(false).updateStory("DEV-2", { title: "Edited" }, user);
  const story = await svc.showStory("DEV-2", user);
  assert.deepEqual(parseStory(serializeStory(story)).dependsOn, ["DEV-1"]);
  assert.deepEqual(story.unresolvedDependencies, ["DEV-1"]);
  await svc.updateStory("DEV-2", { dependsOn: [] }, user);
  assert.deepEqual((await svc.showStory("DEV-2", user)).dependsOn, []);
});

test("graph validation rejects missing, self, transitive cycles and malformed inputs online and offline", async () => {
  const { svc, make } = await setupProject();
  await svc.createStory("DEV", { title: "One" }, user);
  await svc.createStory("DEV", { title: "Two", dependsOn: ["DEV-1"] }, user);
  await svc.createStory("DEV", { title: "Three", dependsOn: ["DEV-2"] }, user);
  for (const service of [svc, make(false)]) {
    await assert.rejects(service.updateStory("DEV-1", { dependsOn: ["DEV-99"] }, user), /DEV-99 does not exist/);
    await assert.rejects(service.updateStory("DEV-1", { dependsOn: ["DEV-1"] }, user), /cycle: DEV-1 → DEV-1/);
    await assert.rejects(service.updateStory("DEV-1", { dependsOn: ["DEV-3"] }, user), /DEV-1 → DEV-3 → DEV-2 → DEV-1/);
    await assert.rejects(
      service.updateStory("DEV-1", { dependsOn: "DEV-2" as unknown as string[] }, user),
      /list of Story keys/,
    );
    await assert.rejects(service.updateStory("DEV-1", { fields: { dependsOn: [] } }, user), /built-in/);
  }
});

test("DEV-7 Done wakes DEV-9 in refinement; a chain advances only by Worker Moves", async () => {
  const { svc, spawns } = await setupProject();
  await svc.addStage("DEV", "In Refinement");
  await svc.updateStage("DEV", "in_refinement", {
    promptEnabled: true,
    prompt: "Reconcile delivered changes and refine.",
  });
  for (let i = 1; i <= 9; i++) await svc.createStory("DEV", { title: `Story ${i}` }, user);
  await svc.updateStory("DEV-9", { dependsOn: ["DEV-7"] }, user);
  await svc.moveStory("DEV-9", "in_refinement", user);
  await svc.createStory("DEV", { title: "Next", stage: "todo", dependsOn: ["DEV-9"] }, user);
  assert.equal(spawns.length, 0);
  await svc.moveStory("DEV-7", "done", user);
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0]!.storyKey, "DEV-9");
  assert.equal(spawns[0]!.stageId, "in_refinement");
  assert.match(spawns[0]!.brief, /reread its prerequisites and delivered changes/);
  await svc.moveStory("DEV-9", "done", worker(spawns[0]!.workerId));
  assert.equal(spawns[1]!.storyKey, "DEV-10");
});

test("multiple prerequisites, already Done prerequisites, and repeated completion events launch once", async () => {
  const { svc, spawns } = await setupProject();
  await svc.createStory("DEV", { title: "One", stage: "done" }, user);
  await svc.createStory("DEV", { title: "Two" }, user);
  await svc.createStory("DEV", { title: "Three" }, user);
  await svc.createStory("DEV", { title: "Waiting", stage: "todo", dependsOn: ["DEV-1", "DEV-2", "DEV-3"] }, user);
  await Promise.all([svc.moveStory("DEV-2", "done", user), svc.moveStory("DEV-3", "done", user)]);
  await svc.drainPending();
  await svc.sweep();
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0]!.storyKey, "DEV-4");
  await svc.createStory("DEV", { title: "Ready", stage: "todo", dependsOn: ["DEV-1"] }, user);
  assert.equal(spawns.length, 2);
});

test("startup resumes dependencies completed offline or by file changes while stopped", async () => {
  const { root, svc, make, spawns } = await setupProject();
  await svc.createStory("DEV", { title: "One" }, user);
  await svc.createStory("DEV", { title: "Waiting", stage: "todo", dependsOn: ["DEV-1"] }, user);
  const file = path.join(root, ".sf/boards/development/stories/DEV-1.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("stage: backlog", "stage: done"));
  await make(true).drainPending();
  await make(true).drainPending();
  assert.equal(spawns.length, 1);
  await svc.createStory("DEV", { title: "Another" }, user);
  await svc.createStory("DEV", { title: "Waiting offline", stage: "todo", dependsOn: ["DEV-3"] }, user);
  await make(false).moveStory("DEV-3", "done", user);
  await make(true).drainPending();
  assert.equal(spawns.length, 2);
});

test("atomic wait cannot lose completion racing the release, including already Done dependencies", async () => {
  for (const doneFirst of [true, false]) {
    const { svc, spawns } = await setupProject();
    await svc.createStory("DEV", { title: "Prerequisite" }, user);
    await svc.createStory("DEV", { title: "Worker", stage: "todo" }, user);
    const actor = worker(spawns[0]!.workerId);
    if (doneFirst) await svc.moveStory("DEV-1", "done", user);
    await Promise.all([
      svc.waitStory("DEV-2", ["DEV-1"], actor),
      ...(doneFirst ? [] : [svc.moveStory("DEV-1", "done", user)]),
    ]);
    assert.equal(spawns.length, 2);
    assert.deepEqual((await svc.showStory("DEV-2", user)).dependsOn, ["DEV-1"]);
    assert.equal((await svc.showStory("DEV-2", user)).hil, undefined);
  }
});

test("dependency edits wake, queued reopens wait, and capacity is deduplicated", async () => {
  const { svc, spawns } = await setupProject({ config: { maxConcurrentWorkers: 1 } });
  await svc.createStory("DEV", { title: "Busy", stage: "todo" }, user);
  await svc.createStory("DEV", { title: "Prerequisite" }, user);
  await svc.createStory("DEV", { title: "Waiting", stage: "todo", dependsOn: ["DEV-2"] }, user);
  await svc.moveStory("DEV-2", "done", user);
  assert.equal((await svc.showStory("DEV-3", user)).queued, true);
  await svc.moveStory("DEV-2", "backlog", user);
  assert.equal((await svc.showStory("DEV-3", user)).queued, undefined);
  await svc.forceRelease("DEV-1");
  assert.equal(spawns.length, 1);
  await svc.updateStory("DEV-3", { dependsOn: [] }, user);
  await svc.drainPending();
  assert.equal(spawns.length, 2);
});

test("HIL and dependencies hold independently, including completion before Worker release", async () => {
  const { svc, spawns } = await setupProject();
  await svc.updateBoard("DEV", { schema: [{ id: "hil", name: "HIL", type: "boolean" }] });
  await svc.updateStage("DEV", "todo", { hilFlag: "hil" });
  await svc.createStory("DEV", { title: "One" }, user);
  await svc.createStory("DEV", { title: "Both", stage: "todo", dependsOn: ["DEV-1"], fields: { hil: true } }, user);
  let held = await svc.showStory("DEV-2", user);
  assert.equal(held.waitingOnDependencies, true);
  assert.ok(held.hil);
  await svc.moveStory("DEV-1", "done", user);
  assert.equal(spawns.length, 0);
  assert.ok((await svc.showStory("DEV-2", user)).hil);
  await svc.updateStory("DEV-2", { fields: { hil: false } }, user);
  assert.equal(spawns.length, 1);
  await svc.createStory("DEV", { title: "Two" }, user);
  await svc.createStory("DEV", { title: "Other", stage: "todo", dependsOn: ["DEV-3"], fields: { hil: true } }, user);
  held = await svc.updateStory("DEV-4", { fields: { hil: false } }, user);
  assert.equal(held.waitingOnDependencies, true);
  assert.equal(spawns.length, 1);
});

test("cross-Board dependencies work; deletion rejects references and missing files hold safely", async () => {
  const { svc, root, spawns } = await setupProject();
  await svc.createBoard("Other", "OTH");
  await svc.createStory("OTH", { title: "External Board" }, user);
  await svc.createStory("DEV", { title: "Wait", stage: "todo", dependsOn: ["OTH-1"] }, user);
  await assert.rejects(svc.deleteStory("OTH-1", user), /required by DEV-1/);
  fs.unlinkSync(path.join(root, ".sf/boards/other/stories/OTH-1.md"));
  await svc.drainPending();
  assert.deepEqual((await svc.showStory("DEV-1", user)).unresolvedDependencies, ["OTH-1"]);
  assert.equal(spawns.length, 0);
});

test("recheck a dispatched spawn before launch, but leave already active Workers running", async () => {
  const { svc, spawns } = await setupProject();
  await svc.createStory("DEV", { title: "One", stage: "done" }, user);
  await svc.createStory("DEV", { title: "Dependent", stage: "todo", dependsOn: ["DEV-1"] }, user);
  await svc.moveStory("DEV-1", "backlog", user);
  assert.deepEqual(await svc.prepareSpawn(spawns[0]!.workerId), { cancelled: true });
  await svc.moveStory("DEV-1", "done", user);
  assert.equal(spawns.length, 2);
  await svc.spawnResult(spawns[1]!.workerId, true);
  await svc.moveStory("DEV-1", "backlog", user);
  assert.ok((await svc.showStory("DEV-2", user)).claim);
  assert.equal(spawns.length, 2);
});

test("editing dependencies to already Done resumes once and wait release respects older capacity work", async () => {
  const { svc, spawns } = await setupProject({ config: { maxConcurrentWorkers: 1 } });
  await svc.createStory("DEV", { title: "Done", stage: "done" }, user);
  await svc.createStory("DEV", { title: "Busy", stage: "todo" }, user);
  await svc.createStory("DEV", { title: "Older", stage: "todo" }, user);
  await svc.waitStory("DEV-2", ["DEV-1"], worker(spawns[0]!.workerId));
  assert.equal(spawns[1]!.storyKey, "DEV-3");
  assert.equal((await svc.showStory("DEV-2", user)).queued, true);
  await svc.forceRelease("DEV-3");
  assert.equal(spawns[2]!.storyKey, "DEV-2");
  await svc.forceRelease("DEV-2");
  await svc.createStory("DEV", { title: "Unclaimed" }, user);
  await svc.moveStory("DEV-4", "todo", user);
  await svc.forceRelease("DEV-4");
  await svc.updateStory("DEV-4", { dependsOn: ["DEV-1"] }, user);
  assert.equal(spawns.length, 5);
  await svc.updateStory("DEV-4", { dependsOn: ["DEV-1"], title: "No second launch" }, user);
  assert.equal(spawns.length, 5);
});

test("a failed brief composition preserves dependency wake intent for recovery", async () => {
  const { svc, root, spawns } = await setupProject();
  await svc.createStory("DEV", { title: "One" }, user);
  await svc.createStory("DEV", { title: "Waiting", stage: "todo", dependsOn: ["DEV-1"] }, user);
  const instructions = path.join(root, ".sf/SF.md");
  fs.mkdirSync(instructions);
  await assert.rejects(svc.moveStory("DEV-1", "done", user), /cannot read Worker instructions/);
  fs.rmdirSync(instructions);
  await svc.drainPending();
  await svc.drainPending();
  assert.equal(spawns.length, 1);
});

test("editing ready dependencies of a capacity-queued Story consumes wake intent once", async () => {
  const { svc, spawns } = await setupProject({ config: { maxConcurrentWorkers: 1 } });
  await svc.createStory("DEV", { title: "Done", stage: "done" }, user);
  await svc.createStory("DEV", { title: "Busy", stage: "todo" }, user);
  await svc.createStory("DEV", { title: "Queued", stage: "todo" }, user);
  await svc.updateStory("DEV-3", { dependsOn: ["DEV-1"] }, user);
  await svc.forceRelease("DEV-2");
  assert.equal(spawns.length, 2);
  assert.equal(spawns[1]!.storyKey, "DEV-3");
  await svc.forceRelease("DEV-3");
  await svc.drainPending();
  assert.equal(spawns.length, 2);
});

for (const change of ["reopen", "edit dependencies", "HIL", "disable prompt", "replace Claim"] as const) {
  test(`spawn eligibility is rechecked after worktree preparation: ${change}`, async () => {
    let signalEntered!: () => void;
    let resume!: () => void;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const gitResumed = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const { svc, spawns, make } = await setupProject({
      git: async (args) => {
        if (args[0] === "worktree" && args[1] === "add") {
          signalEntered();
          await gitResumed;
        }
        return "";
      },
    });
    await svc.updateBoard("DEV", { schema: [{ id: "hil", name: "HIL", type: "boolean" }] });
    await svc.updateStage("DEV", "todo", { hilFlag: "hil" });
    await svc.createStory("DEV", { title: "Prerequisite", stage: "done" }, user);
    await svc.createStory("DEV", { title: "Dependent", stage: "todo", dependsOn: ["DEV-1"] }, user);
    await svc.createStory("DEV", { title: "Other prerequisite" }, user);
    const originalWorker = spawns[0]!.workerId;
    const preparing = svc.prepareSpawn(originalWorker);
    try {
      await entered;
      if (change === "reopen") await svc.moveStory("DEV-1", "backlog", user);
      else if (change === "edit dependencies") await svc.updateStory("DEV-2", { dependsOn: ["DEV-3"] }, user);
      else if (change === "HIL") await svc.updateStory("DEV-2", { fields: { hil: true } }, user);
      else if (change === "disable prompt") await svc.updateStage("DEV", "todo", { promptEnabled: false });
      else {
        await svc.forceRelease("DEV-2");
        await svc.moveStory("DEV-2", "in_progress", user);
      }
    } finally {
      resume();
    }
    assert.deepEqual(await preparing, { cancelled: true });
    const held = await svc.showStory("DEV-2", user);
    if (change === "replace Claim") {
      assert.equal(held.claim?.workerId, spawns[1]!.workerId);
      assert.notEqual(held.claim?.workerId, originalWorker);
      return;
    }
    assert.equal(held.claim, undefined);
    assert.equal(spawns.length, 1);
    if (change === "disable prompt") return;
    if (change === "HIL") {
      assert.ok(held.hil);
      await svc.updateStory("DEV-2", { fields: { hil: false } }, user);
    } else {
      assert.equal(held.waitingOnDependencies, true);
      assert.deepEqual(held.unresolvedDependencies, [change === "reopen" ? "DEV-1" : "DEV-3"]);
      // A new service instance must retain the cancelled spawn's wake intent.
      await make(true).moveStory(change === "reopen" ? "DEV-1" : "DEV-3", "done", user);
    }
    await svc.drainPending();
    await svc.sweep();
    assert.equal(spawns.length, 2);
    const resumed = spawns[1]!;
    assert.equal(resumed.storyKey, "DEV-2");
    assert.equal(resumed.stageId, "todo");
    assert.deepEqual(await svc.prepareSpawn(resumed.workerId), { ok: true });
    assert.equal((await svc.showStory("DEV-2", user)).claim?.workerId, resumed.workerId);
  });
}
