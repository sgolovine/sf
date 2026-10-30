import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { sfPaths } from "../src/server/project/paths.ts";
import { worktreePath } from "../src/server/project/worktree.ts";
import { setupProject, user, worker } from "./helpers.ts";

test("spawns read current Project instructions and isolate boards by id across Stages", async () => {
  const { root, svc, spawns } = await setupProject({ config: { briefPreamble: "Configured guidance" } });
  const paths = sfPaths(root);
  await svc.createBoard("Quality Assurance", "QA");
  await svc.updateStage("QA", "todo", { promptEnabled: true, prompt: "Test it." });
  await svc.updateBoard("DEV", { name: "Renamed Board" });
  fs.writeFileSync(paths.instructions, "Shared v1");
  fs.writeFileSync(paths.boardInstructions("development"), "Development only");
  fs.writeFileSync(paths.boardInstructions("quality_assurance"), "Quality only");
  const otherSf = path.join(worktreePath(root, "DEV-1"), ".sf");
  fs.mkdirSync(path.join(otherSf, "boards/development"), { recursive: true });
  fs.writeFileSync(path.join(otherSf, "SF.md"), "Wrong worktree shared instructions");
  fs.writeFileSync(path.join(otherSf, "boards/development/BOARD.md"), "Wrong worktree board instructions");

  await svc.createStory("DEV", { title: "First", stage: "todo" }, user);
  const first = spawns[0]!.brief;
  assert.ok(first.includes("## SF.md\n\nShared v1"));
  assert.ok(first.includes("## BOARD.md\n\nDevelopment only"));
  assert.ok(first.includes("Configured guidance"));
  assert.ok(!first.includes("Wrong worktree"));
  await svc.createStory("QA", { title: "Other board", stage: "todo" }, user);
  assert.ok(spawns[1]!.brief.includes("Shared v1"));
  assert.ok(spawns[1]!.brief.includes("Quality only"));
  assert.ok(!spawns[1]!.brief.includes("Development only"));

  fs.writeFileSync(paths.instructions, "Shared v2");
  fs.unlinkSync(paths.boardInstructions("development"));
  await svc.moveStory("DEV-1", "in_progress", worker(spawns[0]!.workerId));
  assert.ok(spawns[2]!.brief.includes("Shared v2"));
  assert.ok(!spawns[2]!.brief.includes("## BOARD.md"));
  assert.equal(spawns[0]!.brief, first);
  fs.unlinkSync(paths.instructions);
  fs.writeFileSync(paths.boardInstructions("development"), "Created again");
  await svc.createStory("DEV", { title: "Later", stage: "todo" }, user);
  assert.ok(!spawns[3]!.brief.includes("## SF.md"));
  assert.ok(spawns[3]!.brief.includes("Created again"));
});

test("queued spawns read instructions when capacity becomes available", async () => {
  const { root, svc, spawns } = await setupProject({ config: { maxConcurrentWorkers: 1 } });
  const paths = sfPaths(root);
  fs.writeFileSync(paths.instructions, "Before queue");
  fs.writeFileSync(paths.boardInstructions("development"), "Board before queue");
  await svc.createStory("DEV", { title: "Active", stage: "todo" }, user);
  await svc.createStory("DEV", { title: "Queued", stage: "todo" }, user);
  assert.equal(spawns.length, 1);
  fs.writeFileSync(paths.instructions, "After queue");
  fs.writeFileSync(paths.boardInstructions("development"), "Board after queue");
  await svc.forceRelease("DEV-1");
  assert.equal(spawns[1]!.storyKey, "DEV-2");
  assert.ok(spawns[1]!.brief.includes("After queue"));
  assert.ok(spawns[1]!.brief.includes("Board after queue"));
  assert.ok(!spawns[1]!.brief.includes("Before queue"));
});

test("offline pending triggers read newly created instructions when drained", async () => {
  const { root, svc, spawns, make } = await setupProject();
  const offline = make(false);
  await offline.createStory("DEV", { title: "Pending", stage: "todo" }, user);
  assert.equal(spawns.length, 0);
  const paths = sfPaths(root);
  fs.writeFileSync(paths.instructions, "Created while offline");
  fs.writeFileSync(paths.boardInstructions("development"), "Board while offline");
  await svc.drainPending();
  assert.equal(spawns.length, 1);
  assert.ok(spawns[0]!.brief.includes("Created while offline"));
  assert.ok(spawns[0]!.brief.includes("Board while offline"));
});

for (const scope of ["project", "board"] as const) {
  test(`Worker Moves retain their next-stage spawn when queued ${scope} instructions cannot be read`, async () => {
    const { root, svc, spawns, make } = await setupProject({ config: { maxConcurrentWorkers: 1 } });
    await svc.createBoard("Quality", "QA");
    await svc.updateStage("QA", "todo", { promptEnabled: true, prompt: "Test it." });
    await svc.createStory("DEV", { title: "Moving Worker", stage: "todo" }, user);
    await svc.createStory("QA", { title: "First queued", stage: "todo" }, user);
    await svc.createStory("QA", { title: "Second queued", stage: "todo" }, user);
    const movingWorker = spawns[0]!.workerId;
    const paths = sfPaths(root);
    const file = scope === "project" ? paths.instructions : paths.boardInstructions("quality");
    fs.mkdirSync(file);

    await assert.rejects(svc.moveStory("DEV-1", "in_progress", worker(movingWorker)), (err: Error) => {
      assert.ok(err.message.includes(file));
      assert.ok(err.message.includes("EISDIR"));
      return true;
    });
    const moved = await svc.showStory("DEV-1", user);
    assert.equal(moved.stage, "in_progress");
    assert.equal(moved.claim, undefined);
    assert.equal(moved.queued, true);
    assert.equal(svc.snapshot()!.runtime.workers[movingWorker]!.endReason, "moved");
    assert.deepEqual(
      svc.snapshot()!.runtime.queue.map((q) => `${q.storyKey}:${q.stageId}`),
      ["QA-1:todo", "QA-2:todo", "DEV-1:in_progress"],
    );
    assert.equal(spawns.length, 1);

    fs.rmdirSync(file);
    fs.writeFileSync(file, "Repaired instructions");
    const restarted = make(true);
    await restarted.sweep();
    assert.equal(spawns[1]!.storyKey, "QA-1");
    assert.ok(spawns[1]!.brief.includes("Repaired instructions"));
    await restarted.forceRelease("QA-1");
    assert.equal(spawns[2]!.storyKey, "QA-2");
    await restarted.forceRelease("QA-2");
    assert.equal(spawns[3]!.storyKey, "DEV-1");
    assert.equal(spawns[3]!.stageId, "in_progress");
    assert.ok(spawns[3]!.brief.includes("Build the Story."));
    assert.notEqual(spawns[3]!.workerId, movingWorker);
    assert.deepEqual(restarted.snapshot()!.runtime.queue, []);
    await restarted.sweep();
    assert.equal(spawns.length, 4);
  });

  test(`queued spawns survive ${scope} instruction read errors and resume FIFO`, async () => {
    const { root, svc, spawns, make } = await setupProject({ config: { maxConcurrentWorkers: 1 } });
    for (const title of ["Active", "First queued", "Second queued"])
      await svc.createStory("DEV", { title, stage: "todo" }, user);
    const paths = sfPaths(root);
    const file = scope === "project" ? paths.instructions : paths.boardInstructions("development");
    fs.mkdirSync(file);
    await assert.rejects(svc.forceRelease("DEV-1"), (err: Error) => {
      assert.ok(err.message.includes(file));
      assert.ok(err.message.includes("EISDIR"));
      return true;
    });
    assert.deepEqual(
      svc.snapshot()!.runtime.queue.map((q) => q.storyKey),
      ["DEV-2", "DEV-3"],
    );
    assert.equal(spawns.length, 1);

    fs.rmdirSync(file);
    fs.writeFileSync(file, "Repaired instructions");
    const restarted = make(true);
    await restarted.sweep();
    assert.equal(spawns[1]!.storyKey, "DEV-2");
    assert.ok(spawns[1]!.brief.includes("Repaired instructions"));
    await restarted.forceRelease("DEV-2");
    assert.equal(spawns[2]!.storyKey, "DEV-3");
    assert.deepEqual(restarted.snapshot()!.runtime.queue, []);
    await restarted.sweep();
    assert.equal(spawns.length, 3);
  });

  test(`offline pending spawns survive ${scope} instruction read errors without losing later triggers`, async () => {
    const { root, svc, spawns, make } = await setupProject();
    const offline = make(false);
    await offline.createStory("DEV", { title: "First pending", stage: "todo" }, user);
    await offline.createStory("DEV", { title: "Later pending", stage: "todo" }, user);
    const paths = sfPaths(root);
    const file = scope === "project" ? paths.instructions : paths.boardInstructions("development");
    fs.mkdirSync(file);
    await assert.rejects(svc.drainPending(), (err: Error) => {
      assert.ok(err.message.includes(file));
      assert.ok(err.message.includes("EISDIR"));
      return true;
    });
    assert.deepEqual(
      svc.snapshot()!.runtime.pendingTriggers.map((t) => t.storyKey),
      ["DEV-1", "DEV-2"],
    );
    assert.equal(spawns.length, 0);

    fs.rmdirSync(file);
    fs.writeFileSync(file, "Repaired instructions");
    const restarted = make(true);
    await restarted.drainPending();
    assert.deepEqual(
      spawns.map((s) => s.storyKey),
      ["DEV-1", "DEV-2"],
    );
    assert.ok(spawns.every((s) => s.brief.includes("Repaired instructions")));
    assert.deepEqual(restarted.snapshot()!.runtime.pendingTriggers, []);
    await restarted.drainPending();
    assert.equal(spawns.length, 2);
  });
}

test("a partially drained pending batch retains cleanup and later Boards without replaying dispatched spawns", async () => {
  const { root, svc, spawns, make } = await setupProject();
  await svc.createBoard("Quality", "QA");
  await svc.updateStage("QA", "todo", { promptEnabled: true, prompt: "Test it." });
  const offline = make(false);
  await offline.createStory("DEV", { title: "Cleanup", stage: "done" }, user);
  await offline.createStory("DEV", { title: "Dispatch before failure", stage: "todo" }, user);
  await offline.createStory("QA", { title: "Read failure", stage: "todo" }, user);
  await offline.createStory("DEV", { title: "Dispatch after failure", stage: "todo" }, user);
  const file = sfPaths(root).boardInstructions("quality");
  fs.mkdirSync(file);
  await assert.rejects(svc.drainPending(), /EISDIR/);
  assert.deepEqual(
    spawns.map((s) => s.storyKey),
    ["DEV-2"],
  );
  assert.deepEqual(
    svc.snapshot()!.runtime.pendingTriggers.map((t) => `${t.type}:${t.storyKey}`),
    ["cleanup:DEV-1", "spawn:QA-1", "spawn:DEV-3"],
  );
  await svc.forceRelease("DEV-2");
  fs.rmdirSync(file);
  await svc.drainPending();
  assert.deepEqual(
    spawns.map((s) => s.storyKey),
    ["DEV-2", "QA-1", "DEV-3"],
  );
  assert.deepEqual(svc.snapshot()!.runtime.pendingTriggers, []);
});

test("blank instruction files omit sections; unreadable files surface their paths", async () => {
  for (const scope of ["project", "board"] as const) {
    const { root, svc, spawns } = await setupProject();
    const paths = sfPaths(root);
    const file = scope === "project" ? paths.instructions : paths.boardInstructions("development");
    fs.writeFileSync(file, " \n\t");
    await svc.createStory("DEV", { title: "Blank", stage: "todo" }, user);
    assert.ok(!spawns[0]!.brief.includes("## SF.md"));
    assert.ok(!spawns[0]!.brief.includes("## BOARD.md"));
    fs.unlinkSync(file);
    fs.mkdirSync(file);
    await assert.rejects(svc.createStory("DEV", { title: "Read error", stage: "todo" }, user), (err: Error) => {
      assert.ok(err.message.includes(file));
      assert.ok(err.message.includes("EISDIR"));
      return true;
    });
    assert.equal(spawns.length, 1);
  }
});

test("shared instructions do not enable disabled, blank, absent, or fixed Stage prompts", async () => {
  const { root, svc, spawns } = await setupProject();
  const paths = sfPaths(root);
  fs.writeFileSync(paths.instructions, "Run every Story");
  fs.writeFileSync(paths.boardInstructions("development"), "Run every Stage");
  await svc.createStory("DEV", { title: "Backlog" }, user);
  await svc.moveStory("DEV-1", "in_review", user);
  await svc.updateStage("DEV", "in_review", { promptEnabled: true, prompt: "  " });
  await svc.createStory("DEV", { title: "Blank", stage: "in_review" }, user);
  fs.unlinkSync(path.join(paths.stages("development"), "in_review.md"));
  await svc.createStory("DEV", { title: "Absent", stage: "in_review" }, user);
  await svc.createStory("DEV", { title: "Done", stage: "done" }, user);
  assert.equal(spawns.length, 0);
});

test("shared instructions preserve HIL holds and Claims", async () => {
  const { root, svc, spawns } = await setupProject();
  const paths = sfPaths(root);
  fs.writeFileSync(paths.instructions, "Shared guidance");
  fs.writeFileSync(paths.boardInstructions("development"), "Board guidance");
  await svc.updateBoard("DEV", { schema: [{ id: "needs_human", name: "Needs human", type: "boolean" }] });
  await svc.updateStage("DEV", "todo", { hilFlag: "needs_human" });
  await svc.createStory("DEV", { title: "Held", stage: "todo", fields: { needs_human: true } }, user);
  assert.equal(spawns.length, 0);
  await svc.updateStory("DEV-1", { fields: { needs_human: false } }, user);
  assert.equal(spawns.length, 1);
  assert.ok(spawns[0]!.brief.includes("Shared guidance"));
  assert.ok(spawns[0]!.brief.includes("Board guidance"));
  await assert.rejects(svc.moveStory("DEV-1", "in_progress", user), { code: "claimed" });
  assert.equal(spawns.length, 1);
});
