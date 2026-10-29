import assert from "node:assert/strict";
import { test } from "node:test";
import { setupProject, user, worker } from "./helpers.ts";

test("offline Moves write the file and a pending trigger; the next start spawns", async () => {
  const { svc, spawns, make } = await setupProject();
  await svc.createStory("DEV", { title: "One", stage: "todo" }, user);
  const w1 = worker(spawns[0]!.workerId);
  const offline = make(false);
  await offline.createStory("DEV", { title: "Two" }, user);
  await offline.moveStory("DEV-2", "todo", user);
  await offline.moveStory("DEV-2", "in_progress", user);
  await offline.moveStory("DEV-1", "done", w1);
  const rt = offline.snapshot()!.runtime;
  assert.deepEqual(
    rt.pendingTriggers.map((t) => `${t.type}:${t.storyKey}:${t.stageId ?? ""}`),
    ["spawn:DEV-2:in_progress", "cleanup:DEV-1:"],
  );
  assert.equal(spawns.length, 1);
  assert.equal(offline.listStories("DEV", "in_progress")[0]!.key, "DEV-2");

  await svc.drainPending();
  assert.equal(spawns.length, 2);
  assert.equal(spawns[1]!.storyKey, "DEV-2");
  assert.equal(spawns[1]!.stageId, "in_progress");
  assert.deepEqual(svc.snapshot()!.runtime.pendingTriggers, []);
});

test("a pending spawn is dropped if the Story left the Stage by hand", async () => {
  const { svc, spawns, make } = await setupProject();
  const offline = make(false);
  await offline.createStory("DEV", { title: "One", stage: "todo" }, user);
  await offline.updateStory("DEV-1", {}, user);
  const fs = await import("node:fs");
  const file = `${svc.root}/.sf/boards/development/stories/DEV-1.md`;
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("stage: todo", "stage: in_review"));
  await svc.drainPending();
  assert.equal(spawns.length, 0);
});
