import assert from "node:assert/strict";
import { test } from "node:test";
import { setupProject, user, worker } from "./helpers.ts";

const gone = { code: "claim_gone", message: "claim is gone" };

test("Worker commands refresh the Claim; silence past the timeout ends it", async () => {
  const { svc, spawns, clock } = await setupProject({ config: { claimTimeoutMinutes: 10 } });
  await svc.createStory("DEV", { title: "One", stage: "todo" }, user);
  const w = worker(spawns[0]!.workerId);
  clock.advance(9 * 60_000);
  await svc.showStory("DEV-1", w);
  clock.advance(9 * 60_000);
  await svc.updateStory("DEV-1", { title: "Still mine" }, w);
  clock.advance(11 * 60_000);
  await assert.rejects(svc.showStory("DEV-1", w), gone);
  const s = svc.snapshot()!;
  assert.deepEqual(s.runtime.claims, {});
  assert.equal(s.runtime.workers[w.id]!.endReason, "timeout");
});

test("release and force-release end the Claim", async () => {
  const { svc, spawns } = await setupProject();
  await svc.createStory("DEV", { title: "One", stage: "todo" }, user);
  await svc.createStory("DEV", { title: "Two", stage: "todo" }, user);
  const [w1, w2] = spawns.map((s) => worker(s.workerId));
  await assert.rejects(svc.releaseStory("DEV-2", w1!), gone);
  await svc.releaseStory("DEV-1", w1!);
  await assert.rejects(svc.moveStory("DEV-1", "done", w1!), gone);
  await svc.forceRelease("DEV-2");
  await assert.rejects(svc.updateStory("DEV-2", { title: "x" }, w2!), gone);
  await assert.rejects(svc.forceRelease("DEV-2"), /not claimed/);
  await assert.rejects(svc.showStory("DEV-1", worker("w-unknown")), gone);
});

test("anyone may update a claimed Story; a Worker may create Stories", async () => {
  const { svc, spawns } = await setupProject();
  await svc.createStory("DEV", { title: "One", stage: "todo" }, user);
  await svc.updateStory("DEV-1", { body: "user note" }, user);
  const created = await svc.createStory("DEV", { title: "Follow-up" }, worker(spawns[0]!.workerId));
  assert.equal(created.key, "DEV-2");
});
