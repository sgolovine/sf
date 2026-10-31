import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { WorkerSpawnCommand } from "#model/commands";
import { StoreService } from "../src/server/services/StoreService.ts";
import { tempDir } from "./helpers.ts";

const spawn = (id: string): WorkerSpawnCommand => ({
  type: "worker.spawn",
  workerId: `w-${id}`,
  storyKey: "DEV-1",
  board: "development",
  stageId: "todo",
  mode: "thread",
  worktree: { path: "/wt", branch: "sf/DEV-1" },
  brief: "brief",
  execution: { id, machineId: "local", environmentId: "sfe-1", projectId: "sfp-1" },
});

test("publication deduplicates by key; a restart interrupts claimed launches but requeues instructions", () => {
  const dir = tempDir();
  const file = path.join(dir, "session.json");
  const store = StoreService.create(dir, file);
  const first = StoreService.enqueue(store, spawn("x-1"), "spawn:x-1");
  assert.equal(StoreService.enqueue(store, spawn("x-1"), "spawn:x-1").id, first.id);
  StoreService.enqueue(store, { type: "supervisor.instruct", text: "hi" });
  assert.equal(StoreService.claim(store)?.id, first.id);
  StoreService.claim(store);
  const restarted = StoreService.create(dir, file);
  assert.deepEqual(
    restarted.state.commands.map((c) => c.status),
    ["interrupted", "pending"],
  );
  // An interrupted record never blocks republishing an undelivered launch under its identity.
  const again = StoreService.enqueue(restarted, spawn("x-1"), "spawn:x-1");
  assert.notEqual(again.id, first.id);
  // Late results on interrupted records are kept as evidence, not outcomes.
  StoreService.finish(restarted, first.id, { ok: true, execution: { status: "running", taskId: "t" } });
  const record = restarted.state.commands.find((c) => c.id === first.id)!;
  assert.equal(record.status, "interrupted");
  assert.equal(record.late?.[0]?.execution?.taskId, "t");
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")).length, 0, "session writes are atomic");
});

test("a session write failure does not queue the command", () => {
  const dir = tempDir();
  const store = StoreService.create(dir, path.join(dir, "missing", "deeper", "session.json"));
  fs.writeFileSync(path.join(dir, "missing"), "a file, not a directory");
  assert.throws(() => StoreService.enqueue(store, spawn("x-2"), "spawn:x-2"));
  assert.equal(store.state.commands.length, 0);
});
