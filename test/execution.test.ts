import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import type { CommandStatus, SupervisorCommand, WorkerSpawnCommand } from "#model/commands";
import type { ProjectConfig } from "#model/config";
import { type AdapterSupport, supportFor } from "#model/execution";
import { sfPaths } from "../src/server/project/paths.ts";
import { loadRuntime, saveRuntime } from "../src/server/project/runtime.ts";
import type { ExecutionBoundary, Service } from "../src/server/project/service.ts";
import { OnlineService } from "../src/server/services/OnlineService.ts";
import { StoreService } from "../src/server/services/StoreService.ts";
import { setupProject, user, worker } from "./helpers.ts";
import { scheduling } from "./scheduling-fixture.ts";

type Published = { id: string; command: SupervisorCommand; key: string; status: CommandStatus };

/** A Supervisor boundary that records commands. `commands` survives a simulated restart. */
function fake(support: Partial<AdapterSupport> = {}, commands: Published[] = []) {
  const boundary: ExecutionBoundary & { fail?: boolean } = {
    support: () => ({ ...supportFor(null), ...support }),
    publish(command, key) {
      if (boundary.fail) throw new Error("session write failed");
      const found = commands.find((c) => c.key === key && c.status !== "cancelled" && c.status !== "interrupted");
      if (found) return found.id;
      const id = `c${commands.length + 1}`;
      commands.push({ id, command, key, status: "pending" });
      return id;
    },
    commandState: (id) => commands.find((c) => c.id === id)?.status,
  };
  const spawns = () =>
    commands.filter((c) => c.command.type === "worker.spawn").map((c) => c.command as WorkerSpawnCommand);
  const of = (type: SupervisorCommand["type"]) => commands.filter((c) => c.command.type === type);
  return { boundary, commands, spawns, of };
}

async function project(config: Partial<ProjectConfig> = {}, support: Partial<AdapterSupport> = {}) {
  const f = fake(support);
  const p = await setupProject({ config, execution: f.boundary });
  return { ...p, ...f };
}

/** The Supervisor receives the command and reports the launch accepted with a task id. */
async function launch(svc: Service, spawn: WorkerSpawnCommand, taskId = `task-${spawn.storyKey}`) {
  assert.deepEqual(await svc.prepareSpawn(spawn.workerId), { ok: true });
  await svc.spawnResult(spawn.workerId, true, undefined, { status: "running", taskId });
}

const ended = { status: "terminal", outcome: "completed", evidence: "subagent finished" } as const;
const runtime = (svc: Service) => svc.snapshot()!.runtime;
const occupying = (svc: Service) => Object.values(runtime(svc).executions).filter((e) => e.status !== "terminal");

test("simultaneous requests across Boards reserve each slot once", async () => {
  const { svc, spawns } = await project({ maxConcurrentWorkers: 2 });
  await svc.createBoard("Quality", "QA");
  await svc.updateStage("QA", "todo", { promptEnabled: true, prompt: "Test it." });
  await Promise.all([
    svc.createStory("DEV", { title: "A", stage: "todo" }, user),
    svc.createStory("QA", { title: "B", stage: "todo" }, user),
    svc.createStory("DEV", { title: "C", stage: "todo" }, user),
    svc.createStory("QA", { title: "D", stage: "todo" }, user),
  ]);
  assert.equal(spawns().length, 2);
  assert.equal(new Set(spawns().map((s) => s.execution!.id)).size, 2);
  assert.equal(occupying(svc).length, 2);
  assert.equal(runtime(svc).queue.length, 2);
  const [a, b] = spawns();
  await launch(svc, a!);
  await launch(svc, b!);
  // Releasing both Claims frees no capacity: the executions are still running.
  await svc.releaseStory(a!.storyKey, worker(a!.workerId));
  await svc.releaseStory(b!.storyKey, worker(b!.workerId));
  assert.equal(spawns().length, 2);
  await svc.reportExecution(a!.execution!.id, ended);
  assert.equal(spawns().length, 3);
  await svc.reportExecution(a!.execution!.id, ended);
  assert.equal(spawns().length, 3, "a duplicate terminal report is idempotent");
});

test("a Worker's Move revokes authority but fences the branch until its execution ends", async () => {
  const { svc, spawns } = await project();
  await svc.createStory("DEV", { title: "One", stage: "todo" }, user);
  const first = spawns()[0]!;
  await launch(svc, first);
  await svc.moveStory("DEV-1", "in_progress", worker(first.workerId));
  await assert.rejects(svc.showStory("DEV-1", worker(first.workerId)), { code: "claim_gone" });
  const queued = await svc.showStory("DEV-1", user);
  assert.equal(queued.queued, true);
  assert.deepEqual(queued.wait?.reasons, [{ code: "branch-occupied", executionId: first.execution!.id }]);
  assert.equal(queued.execution?.status, "running");
  await assert.rejects(svc.ensureStoryWorktree("DEV-1"), { code: "claimed" });
  await assert.rejects(svc.removeWorktree("DEV-1", false), { code: "claimed" });
  assert.equal(spawns().length, 1);
  // Late launch evidence attaches to the old generation without restoring its Claim.
  await svc.spawnResult(first.workerId, true, undefined, { status: "running", threadId: "thread-1" });
  assert.equal(runtime(svc).claims["DEV-1"], undefined);
  assert.equal(runtime(svc).executions[first.execution!.id]!.threadId, "thread-1");
  await svc.reportExecution(first.execution!.id, ended);
  const next = spawns()[1]!;
  assert.equal(next.stageId, "in_progress");
  assert.notEqual(next.execution!.id, first.execution!.id);
  assert.equal(next.worktree.branch, first.worktree.branch);
});

test("timeout and force-release keep an unknown reservation that reconciliation resolves", async () => {
  const { svc, spawns, of, commands, clock } = await project({ maxConcurrentWorkers: 1, claimTimeoutMinutes: 10 });
  await svc.createStory("DEV", { title: "One", stage: "todo" }, user);
  await svc.createStory("DEV", { title: "Two", stage: "todo" }, user);
  const first = spawns()[0]!;
  await launch(svc, first);
  clock.advance(11 * 60_000);
  await svc.sweep();
  await assert.rejects(svc.showStory("DEV-1", worker(first.workerId)), { code: "claim_gone" });
  const e = runtime(svc).executions[first.execution!.id]!;
  assert.equal(e.status, "unknown");
  assert.equal(spawns().length, 1, "the timed-out execution still holds the only slot");
  // One outstanding lookup, never a relaunch, and repeated sweeps do not add more.
  await svc.sweep();
  await svc.sweep();
  const lookups = of("execution.reconcile");
  assert.equal(lookups.length, 1);
  const lookup = lookups[0]!.command as Extract<SupervisorCommand, { type: "execution.reconcile" }>;
  assert.equal(lookup.taskId, "task-DEV-1");
  // A stale attempt cannot overwrite the current one.
  await svc.attemptResult({ ...lookup, attemptId: "a-stale" }, true, undefined, ended);
  assert.equal(runtime(svc).executions[first.execution!.id]!.status, "unknown");
  await svc.attemptResult(lookup, true, undefined, { status: "running", evidence: "task active" });
  assert.equal(runtime(svc).executions[first.execution!.id]!.status, "running");
  assert.equal(spawns().length, 1);
  // Backoff: the next attempt waits; then a fresh attempt confirms the end.
  await svc.sweep();
  assert.equal(of("execution.reconcile").length, 1);
  clock.advance(61_000);
  await svc.sweep();
  const again = of("execution.reconcile")[1]!.command as typeof lookup;
  assert.notEqual(again.attemptId, lookup.attemptId);
  // Older answers stay stale after the newer attempt.
  await svc.attemptResult(lookup, true, undefined, ended);
  assert.equal(spawns().length, 1);
  await svc.attemptResult(again, true, undefined, ended);
  assert.equal(spawns()[1]?.storyKey, "DEV-2");
  assert.ok(
    commands.every((c) => c.command.type !== "worker.spawn" || c.command.storyKey !== "DEV-1" || c.id === "c1"),
  );

  // Force-release while running is just as uncertain.
  const second = spawns()[1]!;
  await launch(svc, second);
  await svc.forceRelease("DEV-2");
  assert.equal(runtime(svc).executions[second.execution!.id]!.status, "unknown");
});

test("cap 0 and lowered caps stop new reservations without stopping running Workers", async () => {
  const { svc, root, spawns } = await project({ scheduling: { ...scheduling(), order: ["local"] } });
  for (const title of ["A", "B", "C"]) await svc.createStory("DEV", { title, stage: "todo" }, user);
  assert.equal(spawns().length, 2);
  for (const s of spawns()) await launch(svc, s);
  const file = sfPaths(root).config;
  const write = (capacity: number) => {
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, JSON.stringify({ ...config, scheduling: { ...config.scheduling, local: { capacity } } }));
  };
  write(1);
  await svc.sweep();
  assert.equal(occupying(svc).length, 2, "nothing is stopped");
  await svc.reportExecution(spawns()[0]!.execution!.id, ended);
  assert.equal(spawns().length, 2, "usage 1 is still at the lowered cap");
  const held = await svc.showStory("DEV-3", user);
  assert.deepEqual(held.wait?.reasons, [{ machineId: "local", code: "capacity" }]);
  write(0);
  await svc.reportExecution(spawns()[1]!.execution!.id, ended);
  assert.equal(spawns().length, 2, "cap 0 starts nothing");
  write(1);
  await svc.sweep();
  assert.equal(spawns()[2]?.storyKey, "DEV-3");
});

test("eligible FIFO skips full or unavailable pins without blocking later work", async () => {
  const remotes = { ...scheduling(), local: { capacity: 1 }, order: ["local"] };
  remotes.remotes[0]!.capacity = 1;
  const { svc, spawns } = await project({ scheduling: remotes }, { remote: true });
  const required = { mode: "required", machineId: "a" } as const;
  await svc.createStory("DEV", { title: "A1", stage: "todo", placement: required }, user);
  await svc.createStory("DEV", { title: "A2", stage: "todo", placement: required }, user);
  await svc.createStory("DEV", { title: "Local", stage: "todo" }, user);
  await svc.createStory(
    "DEV",
    { title: "Pref", stage: "todo", placement: { mode: "preferred", machineId: "b" } },
    user,
  );
  await svc.createStory("DEV", { title: "Pinned local", stage: "todo", placement: { mode: "local-only" } }, user);
  assert.deepEqual(
    spawns().map((s) => `${s.storyKey}@${s.execution!.machineId}`),
    ["DEV-1@a", "DEV-3@local", "DEV-4@b"],
  );
  const a = spawns()[0]!.execution!;
  assert.deepEqual([a.environmentId, a.projectId], ["env-a", "project-a"]);
  assert.deepEqual((await svc.showStory("DEV-2", user)).wait?.reasons, [{ machineId: "a", code: "capacity" }]);
  assert.deepEqual((await svc.showStory("DEV-5", user)).wait?.reasons, [{ machineId: "local", code: "capacity" }]);
  // Repeated drains keep the original order and age.
  const before = runtime(svc).queue.map((q) => [q.storyKey, q.queuedAt, q.seq]);
  await svc.sweep();
  assert.deepEqual(
    runtime(svc).queue.map((q) => [q.storyKey, q.queuedAt, q.seq]),
    before,
  );
  // A placement edit wakes the queue: DEV-2 now prefers local's free slot after DEV-3 ends.
  await svc.reportExecution(spawns()[1]!.execution!.id, ended);
  assert.equal(spawns()[3]?.storyKey, "DEV-5", "the oldest eligible local entry goes first");
  await svc.updateStory("DEV-2", { placement: { mode: "preferred", machineId: "b" } }, user);
  assert.equal(spawns()[4]?.storyKey, "DEV-2");
  assert.equal(spawns()[4]?.execution?.machineId, "b");
  // A remote reservation cannot be prepared until DEV-11: it never started.
  const remote = spawns()[0]!;
  assert.match(String(((await svc.prepareSpawn(remote.workerId)) as { error: string }).error), /DEV-11/);
});

test("production remotes are incompatible: required waits, preferred falls back before reservation", async () => {
  const { svc, spawns } = await project({ scheduling: scheduling() });
  await svc.createStory("DEV", { title: "Req", stage: "todo", placement: { mode: "required", machineId: "b" } }, user);
  await svc.createStory(
    "DEV",
    { title: "Pref", stage: "todo", placement: { mode: "preferred", machineId: "b" } },
    user,
  );
  assert.deepEqual(
    spawns().map((s) => `${s.storyKey}@${s.execution!.machineId}`),
    ["DEV-2@local"],
  );
  const wait = (await svc.showStory("DEV-1", user)).wait?.reasons[0];
  assert.equal(wait?.code, "incompatible");
  assert.match(String(wait && "detail" in wait ? wait.detail : ""), /DEV-11/);
});

test("a changed mapping under an occupied slug keeps its charge and blocks that slug", async () => {
  const config = scheduling();
  const { svc, root, spawns } = await project({ scheduling: { ...config, order: ["a"] } }, { remote: true });
  await svc.createStory("DEV", { title: "One", stage: "todo" }, user);
  await svc.createStory("DEV", { title: "Two", stage: "todo" }, user);
  assert.equal(spawns().length, 2);
  const file = sfPaths(root).config;
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  json.scheduling.remotes[0].environmentId = "env-moved";
  fs.writeFileSync(file, JSON.stringify(json));
  await svc.createStory("DEV", { title: "Three", stage: "todo" }, user);
  assert.equal(spawns().length, 2);
  assert.equal((await svc.showStory("DEV-3", user)).wait?.reasons[0]?.code, "unmapped");
  // Removing the machine cannot hide its occupied entries or their branch fences.
  json.scheduling.remotes = json.scheduling.remotes.slice(1);
  json.scheduling.order = ["local"];
  fs.writeFileSync(file, JSON.stringify(json));
  await svc.sweep();
  assert.equal(occupying(svc).length, 3);
  assert.equal(spawns()[2]?.storyKey, "DEV-3");
  await assert.rejects(svc.ensureStoryWorktree("DEV-1"), { code: "claimed" });
});

test("cancellation during preparation never delivers; confirmed failures free the slot", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fake();
  const { svc } = await setupProject({
    config: { maxConcurrentWorkers: 1 },
    execution: f.boundary,
    git: async (args) => {
      if (args[0] === "worktree" && args[1] === "add") await gate;
      return "";
    },
  });
  await svc.createStory("DEV", { title: "One", stage: "todo" }, user);
  await svc.createStory("DEV", { title: "Two", stage: "todo" }, user);
  const first = f.spawns()[0]!;
  const preparing = svc.prepareSpawn(first.workerId);
  await new Promise((r) => setTimeout(r, 20));
  await svc.forceRelease("DEV-1");
  release();
  assert.deepEqual(await preparing, { cancelled: true });
  const e = runtime(svc).executions[first.execution!.id]!;
  assert.deepEqual([e.status, e.outcome], ["terminal", "not-started"]);
  const second = f.spawns()[1]!;
  assert.equal(second.storyKey, "DEV-2");
  // The Supervisor confirms it started nothing: the slot is free again.
  assert.deepEqual(await svc.prepareSpawn(second.workerId), { ok: true });
  await svc.spawnResult(second.workerId, false, "unsupported model", { status: "not-started", evidence: "no tool" });
  assert.equal(occupying(svc).length, 0);
  assert.equal((await svc.showStory("DEV-2", user)).failure?.error, "unsupported model");
});

test("an unqualified failure after delivery stays occupied; mismatched or stale reports change nothing", async () => {
  const { svc, spawns } = await project({ maxConcurrentWorkers: 1 });
  await svc.createStory("DEV", { title: "One", stage: "todo" }, user);
  await svc.createStory("DEV", { title: "Two", stage: "todo" }, user);
  const first = spawns()[0]!;
  assert.deepEqual(await svc.prepareSpawn(first.workerId), { ok: true });
  const before = JSON.stringify(runtime(svc).executions);
  await assert.rejects(
    svc.spawnResult(first.workerId, true, undefined, { status: "running", machineId: "b" }),
    /machineId "b" does not match/,
  );
  await assert.rejects(svc.reportExecution(first.execution!.id, { ...ended, projectId: "sfp-other" }), {
    code: "invalid",
  });
  assert.equal(JSON.stringify(runtime(svc).executions), before);
  await svc.spawnResult(first.workerId, false, "timed out");
  const e = runtime(svc).executions[first.execution!.id]!;
  assert.equal(e.status, "unknown");
  assert.equal(runtime(svc).claims["DEV-1"], undefined);
  assert.equal((await svc.showStory("DEV-1", user)).failure?.error, "timed out");
  assert.equal(spawns().length, 1, "an uncertain launch keeps its slot");
  await svc.reportExecution(first.execution!.id, { status: "not-started", evidence: "operator checked: no thread" });
  assert.equal(spawns()[1]?.storyKey, "DEV-2");
  // A contradicting report after the end occupies again until reconciled; it never restores a Claim.
  await svc.reportExecution(first.execution!.id, { status: "running", evidence: "thread seen" });
  const conflicted = runtime(svc).executions[first.execution!.id]!;
  assert.equal(conflicted.status, "unknown");
  assert.match(String(conflicted.conflict), /after not-started/);
  assert.equal(runtime(svc).claims["DEV-1"], undefined);
});

test("Done cleanup waits for the execution to end, then runs", async () => {
  const calls: string[][] = [];
  const f = fake();
  const { svc } = await setupProject({
    execution: f.boundary,
    git: async (args) => {
      calls.push(args);
      return "";
    },
  });
  await svc.createStory("DEV", { title: "One", stage: "todo" }, user);
  const first = f.spawns()[0]!;
  await launch(svc, first);
  calls.length = 0;
  await svc.moveStory("DEV-1", "done", worker(first.workerId));
  assert.ok(runtime(svc).deferredCleanups["DEV-1"]);
  assert.equal(
    calls.some((c) => c[0] === "worktree" && c[1] === "remove"),
    false,
  );
  await svc.reportExecution(first.execution!.id, ended);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(runtime(svc).deferredCleanups["DEV-1"], undefined);
  assert.ok(calls.some((c) => c.includes("worktree")));
});

test("publication failure keeps the reservation and republishes the same launch identity", async () => {
  const { svc, boundary, spawns } = await project();
  boundary.fail = true;
  await assert.rejects(svc.createStory("DEV", { title: "One", stage: "todo" }, user), /session write failed/);
  const [e] = occupying(svc);
  assert.equal(e?.status, "reserved");
  assert.equal(e?.commandId, undefined);
  boundary.fail = false;
  await svc.sweep();
  assert.equal(spawns().length, 1);
  assert.equal(spawns()[0]!.execution!.id, e!.id);
  assert.equal(runtime(svc).executions[e!.id]!.commandId, "c1");
});

test("restart recovery: republish undelivered intents once, never redeliver a delivered launch", async () => {
  const commands: Published[] = [];
  const f = fake({}, commands);
  const { svc, root, make } = await setupProject({ execution: f.boundary, config: { maxConcurrentWorkers: 3 } });
  await svc.createStory("DEV", { title: "Lost before recording", stage: "todo" }, user);
  await svc.createStory("DEV", { title: "Claimed, not prepared", stage: "todo" }, user);
  await svc.createStory("DEV", { title: "Delivered", stage: "todo" }, user);
  const [lost, claimed, delivered] = f.spawns();
  assert.deepEqual(await svc.prepareSpawn(delivered!.workerId), { ok: true });
  // Crash after the boundary saved the command but before sf recorded its id.
  const rt = loadRuntime(root);
  delete rt.executions[lost!.execution!.id]!.commandId;
  saveRuntime(root, rt);
  // The Supervisor had claimed two commands when the server stopped.
  for (const c of commands) if (c.command !== lost) c.status = "interrupted";
  commands[0]!.status = "pending";
  const restarted = make(true);
  await restarted.recover();
  const after = runtime(restarted).executions;
  assert.equal(after[lost!.execution!.id]!.commandId, "c1", "deduplicated by launch identity");
  assert.equal(after[claimed!.execution!.id]!.status, "reserved");
  assert.equal(after[claimed!.execution!.id]!.commandId, "c4", "never delivered: republished under the same identity");
  assert.equal(after[delivered!.execution!.id]!.status, "unknown");
  assert.equal(f.spawns().length, 4);
  assert.equal(new Set(f.spawns().map((s) => s.execution!.id)).size, 3);
  // The late result for the interrupted delivered command is still accepted as evidence.
  await restarted.spawnResult(delivered!.workerId, true, undefined, { status: "running", taskId: "t-9" });
  assert.equal(runtime(restarted).executions[delivered!.execution!.id]!.status, "running");
  assert.equal(runtime(restarted).claims["DEV-3"]?.status, "active");
});

test("a lost launch response without identity waits for explicit recovery", async () => {
  const { svc, spawns, of, make } = await project();
  await svc.createStory("DEV", { title: "One", stage: "todo" }, user);
  const first = spawns()[0]!;
  assert.deepEqual(await svc.prepareSpawn(first.workerId), { ok: true });
  const restarted = make(true);
  await restarted.recover();
  await restarted.sweep();
  const e = runtime(restarted).executions[first.execution!.id]!;
  assert.equal(e.status, "unknown");
  assert.match(String(e.recovery), /no task or thread identity/);
  assert.equal(of("execution.reconcile").length, 0, "no automatic lookup without an identity");
  assert.equal(of("worker.spawn").length, 1, "never relaunched");
  // The operator asks the Supervisor, which adopts the running execution by its own records.
  await restarted.requestReconcile(first.execution!.id);
  const lookup = of("execution.reconcile")[0]!.command as Extract<SupervisorCommand, { type: "execution.reconcile" }>;
  await restarted.attemptResult(lookup, true, undefined, { status: "running", taskId: "task-found" });
  assert.equal(runtime(restarted).executions[first.execution!.id]!.taskId, "task-found");
  // Cancellation acknowledgement alone keeps the slot.
  await restarted.requestCancel(first.execution!.id);
  const cancel = of("execution.cancel")[0]!.command as Extract<SupervisorCommand, { type: "execution.cancel" }>;
  await restarted.attemptResult(cancel, true, "cancel_requested");
  assert.equal(runtime(restarted).executions[first.execution!.id]!.status, "unknown");
  await restarted.reportExecution(first.execution!.id, {
    status: "terminal",
    outcome: "cancelled",
    evidence: "task_status: cancelled",
  });
  assert.equal(occupying(restarted).length, 0);
});

test("version 1 runtime migrates live Claims to occupying executions, repeatably", async () => {
  const { svc, root, make, commands } = await project();
  await svc.createStory("DEV", { title: "Active", stage: "todo" }, user);
  await svc.createStory("DEV", { title: "Spawning", stage: "todo" }, user);
  await svc.createStory("DEV", { title: "History" }, user);
  const current = loadRuntime(root);
  const [active, spawning] = Object.values(current.claims);
  const legacy = {
    version: 1,
    claims: {
      "DEV-1": { ...active, status: "active", executionId: undefined, machineId: undefined },
      "DEV-2": { ...spawning, status: "spawning", commandId: "c2", executionId: undefined, machineId: undefined },
    },
    queue: [{ storyKey: "DEV-3", board: "development", stageId: "todo", queuedAt: 5 }],
    dependencyWaits: {},
    failures: {},
    worktreeWarnings: {},
    workers: {
      [active!.workerId]: { storyKey: "DEV-1", stageId: "todo", mode: "thread", threadId: "thread-7", startedAt: 1 },
      [spawning!.workerId]: { storyKey: "DEV-2", stageId: "todo", mode: "thread", startedAt: 1 },
      "w-old": { storyKey: "DEV-3", stageId: "todo", mode: "thread", startedAt: 1, endedAt: 2, endReason: "moved" },
    },
    pendingTriggers: [],
    futureField: { kept: true },
  };
  fs.writeFileSync(sfPaths(root).stateJson, JSON.stringify(legacy));
  const read = loadRuntime(root);
  assert.deepEqual(loadRuntime(root).executions, read.executions, "unsaved reads agree");
  const migrated = Object.values(read.executions);
  assert.equal(migrated.length, 2);
  const byKey = Object.fromEntries(migrated.map((e) => [e.storyKey, e]));
  assert.deepEqual([byKey["DEV-1"]!.status, byKey["DEV-1"]!.label], ["running", "thread-7"]);
  assert.equal(byKey["DEV-2"]!.status, "launching");
  assert.equal(read.queue[0]!.seq, 0);
  assert.equal((read as unknown as { futureField: unknown }).futureField !== undefined, true);
  // The legacy spawning command was claimed before the restart: it is not safe to launch again.
  commands.find((c) => c.id === "c2")!.status = "interrupted";
  const restarted = make(true);
  await restarted.recover();
  const saved = loadRuntime(root);
  assert.equal(saved.version, 2);
  assert.equal(saved.executions[byKey["DEV-2"]!.id]!.status, "unknown");
  assert.equal(saved.claims["DEV-1"]!.executionId, byKey["DEV-1"]!.id);
  assert.deepEqual(saved.identity, read.identity);
  assert.deepEqual(loadRuntime(root), saved, "migrating again is a no-op");
});

test("capability registration wakes the queue with fresh eligibility", async () => {
  const { root } = await setupProject();
  const store = StoreService.create(root, null);
  const online = OnlineService.create(store, { root, sf: "sf", git: async () => "" });
  const tools = (spawn: boolean) => ({
    agent: "claude-code",
    model: "m",
    app: "terminal",
    canSpawnThreads: false,
    canSpawnSubagents: spawn,
  });
  StoreService.setCapabilities(store, tools(false));
  await online.createStory("DEV", { title: "One", stage: "todo" }, user);
  const held = await online.showStory("DEV-1", user);
  assert.equal(held.wait?.reasons[0]?.code, "incompatible");
  assert.equal(store.state.commands.length, 0);
  StoreService.setCapabilities(store, tools(true));
  await online.drainPending();
  const record = store.state.commands[0]!;
  assert.equal(record.command.type, "worker.spawn");
  assert.equal(record.key, `spawn:${(record.command as WorkerSpawnCommand).execution!.id}`);
  assert.match(String(online.executions().support.lookupByRequest), /cannot look up/);
});
