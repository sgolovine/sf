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
