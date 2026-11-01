import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { type ProjectSettingsResponse, routes, type StoryDetails } from "#model/api";
import { loadProjectConfig } from "../src/server/project/config.ts";
import { sfPaths } from "../src/server/project/paths.ts";
import { createApp, listen } from "../src/server/server.ts";
import { ClientService, type ServerInfo } from "../src/server/services/ClientService.ts";
import { OnlineService } from "../src/server/services/OnlineService.ts";
import { StoreService } from "../src/server/services/StoreService.ts";
import { setupProject, tempDir, tempRepo, user, worker } from "./helpers.ts";
import { legacyScheduling, machines, remoteMachines, scheduling } from "./scheduling-fixture.ts";

const occupying = (svc: Awaited<ReturnType<typeof setupProject>>["svc"]) =>
  Object.values(svc.snapshot()!.runtime.executions).filter((e) => e.status !== "terminal");

test("updateProject writes the catalog and scheduling atomically: replace, clear and unrelated config", async () => {
  const { svc, root } = await setupProject({ config: { briefPreamble: "Keep me" } });
  await svc.updateProject({ model: "project-model" });
  const set = await svc.updateProject(machines());
  assert.deepEqual(set.config.scheduling, scheduling());
  assert.deepEqual(set.config.remoteMachines, remoteMachines());
  assert.deepEqual(set.policy.order, ["a", "b", "local"]);
  assert.deepEqual(
    set.machines.map((m) => [m.id, m.used, m.capacity]),
    [
      ["local", 0, 2],
      ["a", 0, 4],
      ["b", 0, 2],
    ],
  );
  const saved = loadProjectConfig(root);
  assert.equal(saved.briefPreamble, "Keep me");
  assert.equal(saved.worker.model, "project-model");
  // Omitted keys are unchanged; a supplied value replaces the whole value.
  await svc.updateProject({ model: "other" });
  assert.deepEqual(loadProjectConfig(root).scheduling, scheduling());
  assert.deepEqual(loadProjectConfig(root).remoteMachines, remoteMachines());
  // Scheduling can go while the catalog stays; the Project maximum stays editable either way.
  const unscheduled = await svc.updateProject({ scheduling: null, maxConcurrentWorkers: 5 });
  assert.equal(unscheduled.config.scheduling, undefined);
  assert.deepEqual(unscheduled.config.remoteMachines, remoteMachines());
  assert.deepEqual(unscheduled.policy.order, ["local"]);
  assert.equal(unscheduled.policy.machines.local?.capacity, 5);
  const replaced = await svc.updateProject({ scheduling: { local: { capacity: 1 }, order: ["local"] } });
  assert.deepEqual(replaced.config.scheduling, { local: { capacity: 1 }, order: ["local"] });
  await svc.updateProject({ maxConcurrentWorkers: 6 });
  assert.equal(loadProjectConfig(root).scheduling?.local.capacity, 1, "explicit local capacity keeps its meaning");
  const cleared = await svc.updateProject({ scheduling: null, remoteMachines: [] });
  const file = JSON.parse(fs.readFileSync(sfPaths(root).config, "utf8"));
  assert.equal(Object.hasOwn(file, "scheduling"), false);
  assert.equal(Object.hasOwn(file, "remoteMachines"), false);
  assert.deepEqual(cleared.policy, { machines: { local: { capacity: 6, enabled: true } }, order: ["local"] });
  assert.equal(loadProjectConfig(root).briefPreamble, "Keep me");

  const bad = remoteMachines();
  bad[1]!.capacity = -1;
  await assert.rejects(svc.updateProject({ remoteMachines: bad }), /remoteMachines\[1\]\.capacity/);
  await assert.rejects(svc.updateProject({ scheduling: scheduling() }), /unknown machine ID "a"/);
  await assert.rejects(svc.updateProject({ scheduling: legacyScheduling() as never }), /moved to remoteMachines/);
  await assert.rejects(svc.updateProject({ maxConcurrentWorkers: 1.5 }), /maxConcurrentWorkers/);
  await assert.rejects(svc.updateProject({ scheduling: "x" as never }), { code: "invalid" });
  await assert.rejects(svc.updateProject({ remoteMachines: null as never }), { code: "invalid" });
  assert.equal(loadProjectConfig(root).scheduling, undefined, "a rejected write changes nothing");
  assert.equal(loadProjectConfig(root).remoteMachines, undefined);
  // Removing a slug the kept order names fails as one write.
  await svc.updateProject(machines());
  await assert.rejects(svc.updateProject({ remoteMachines: remoteMachines().slice(1) }), /unknown machine ID "a"/);
  assert.deepEqual(loadProjectConfig(root).remoteMachines, remoteMachines());
});

test("a legacy scheduling.remotes config loads without a rewrite and saves canonically", async () => {
  const { svc, root, spawns } = await setupProject({ config: { scheduling: legacyScheduling() as never } });
  const file = sfPaths(root).config;
  const before = fs.readFileSync(file, "utf8");
  const shown = svc.showProject();
  assert.deepEqual(shown.config.remoteMachines, remoteMachines());
  assert.deepEqual(shown.config.scheduling, scheduling());
  await svc.createStory(
    "DEV",
    { title: "Pinned", stage: "todo", placement: { mode: "required", machineId: "b" } },
    user,
  );
  assert.equal(spawns[0]!.execution?.machineId, "b");
  assert.equal(fs.readFileSync(file, "utf8"), before, "reading and dispatch never rewrite the config");
  await svc.updateProject({ model: "m" });
  const canonical = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(canonical.remoteMachines, remoteMachines());
  assert.deepEqual(canonical.scheduling, scheduling());
  assert.doesNotMatch(JSON.stringify(canonical), /env-|project-a|repository/);
  fs.writeFileSync(file, JSON.stringify({ ...canonical, scheduling: legacyScheduling() }));
  assert.throws(() => svc.showProject(), /conflicts with remoteMachines/);
});

test("cap changes drain the queue and never stop running Workers", async () => {
  const { svc, spawns } = await setupProject({ config: { maxConcurrentWorkers: 1 } });
  for (const title of ["A", "B", "C"]) await svc.createStory("DEV", { title, stage: "todo" }, user);
  assert.equal(spawns.length, 1);
  await svc.updateProject({ maxConcurrentWorkers: 2 });
  assert.equal(spawns.length, 2, "a raised cap launches queued work");
  const lowered = await svc.updateProject({ scheduling: { local: { capacity: 0 }, order: ["local"] } });
  assert.equal(occupying(svc).length, 2, "a lowered cap stops nothing");
  assert.deepEqual(lowered.machines, [{ id: "local", used: 2, capacity: 0, enabled: true, configured: true }]);
  assert.deepEqual((await svc.showStory("DEV-3", user)).wait?.reasons, [{ machineId: "local", code: "capacity" }]);
  await svc.forceRelease("DEV-1");
  assert.equal(spawns.length, 2, "cap 0 starts nothing");
});

test("reference checks reject removed or changed slugs and allow labels, caps, order and disabling", async () => {
  const { svc, spawns } = await setupProject({
    config: { remoteMachines: remoteMachines(), scheduling: { ...scheduling(), order: ["b"] } },
  });
  await svc.createBoard("Quality", "QA");
  const required = await svc.createStory(
    "QA",
    { title: "Pinned", placement: { mode: "required", machineId: "a" } },
    user,
  );
  const running = await svc.createStory("DEV", { title: "Running", stage: "todo" }, user);
  assert.equal(running.execution?.machineId, "b");
  const order = { scheduling: { ...scheduling(), order: ["local"] } };
  const without = (id: string) => remoteMachines().filter((r) => r.id !== id);
  await assert.rejects(svc.updateProject({ ...order, remoteMachines: without("a") }), (err: Error) => {
    assert.match(err.message, new RegExp(`${required.key} has required placement on a`));
    assert.match(err.message, /disable a instead/);
    return true;
  });
  await assert.rejects(
    svc.updateProject({ ...order, remoteMachines: without("b") }),
    /execution x-\w+ \(DEV-1, reserved\) occupies b/,
  );
  const renamed = remoteMachines();
  renamed[1]!.id = "b2";
  await assert.rejects(svc.updateProject({ ...order, remoteMachines: renamed }), /occupies b; keep the machine/);
  await assert.rejects(svc.updateProject({ ...order, remoteMachines: [] }), (err: Error) => {
    assert.match(err.message, /QA-1 has required placement on a/);
    assert.match(err.message, /occupies b/);
    return true;
  });
  // Scheduling no longer holds machines: turning it off keeps every reference.
  await svc.updateProject({ scheduling: null });
  await svc.updateProject({ scheduling: { ...scheduling(), order: ["b"] } });
  // Allowed: labels, capacity below usage, order and disabling a referenced remote.
  const allowed = remoteMachines();
  allowed[0]!.name = "Renamed";
  allowed[0]!.enabled = false;
  allowed[1]!.capacity = 0;
  await svc.updateProject({ ...order, remoteMachines: allowed });
  assert.equal(occupying(svc).length, 1, "the execution on b keeps running");
  await svc.updateStage("QA", "todo", { promptEnabled: true, prompt: "Test it." });
  await svc.moveStory(required.key, "todo", user);
  assert.deepEqual((await svc.showStory(required.key, user)).wait?.reasons, [{ machineId: "a", code: "disabled" }]);
  assert.equal(spawns.length, 1, "a required target never falls back");
  // Once references are resolved, removal is allowed.
  await svc.updateStory(required.key, { placement: null }, user);
  await svc.forceRelease(running.key);
  await svc.reportExecution(running.execution!.id, { status: "terminal", outcome: "completed", evidence: "ended" });
  await svc.updateProject({ ...order, remoteMachines: [] });
});

test("the launch request names only the machine, with the exact sentence in both places", async () => {
  const { svc, spawns } = await setupProject();
  await svc.updateProject({ remoteMachines: remoteMachines(), scheduling: { ...scheduling(), order: ["b", "local"] } });
  await svc.createStory("DEV", { title: "Req", placement: { mode: "required", machineId: "a" } }, user);
  await svc.createStory("DEV", { title: "Pref", placement: { mode: "preferred", machineId: "a" } }, user);
  await svc.createStory("DEV", { title: "Default" }, user);
  for (const key of ["DEV-1", "DEV-2", "DEV-3"]) await svc.moveStory(key, "todo", user);
  const [req, pref, def] = spawns;
  assert.deepEqual(
    [req, pref, def].map((s) => [s!.machine?.id, s!.machine?.name]),
    [
      ["a", "A"],
      ["a", "A"],
      ["b", "B"],
    ],
  );
  for (const s of [req, pref, def]) {
    const sentence = `The user specified that this work should be done on the machine: ${s!.machine!.id}`;
    assert.ok(s!.machine!.instructions.includes(sentence));
    assert.ok(s!.brief.includes(sentence));
    assert.ok(s!.brief.endsWith(`${s!.machine!.instructions}\n`));
    assert.deepEqual(Object.keys(s!.machine!).sort(), ["id", "instructions", "name"]);
  }
  assert.match(req!.machine!.instructions, /start nothing/);
  assert.match(pref!.machine!.instructions, /may start it on the Supervisor's machine/);
  // Remote executions carry sf's own identity, like local ones.
  const { identity } = svc.snapshot()!.runtime;
  assert.deepEqual(
    [req!.execution?.environmentId, req!.execution?.projectId],
    [identity.environmentId, identity.projectId],
  );

  // Without local in the order, preferred has no local fallback.
  await svc.updateProject({ scheduling: { ...scheduling(), order: ["b"] } });
  await svc.createStory(
    "DEV",
    { title: "Pref only", stage: "todo", placement: { mode: "preferred", machineId: "b" } },
    user,
  );
  assert.match(spawns[3]!.machine!.instructions, /start nothing/);

  // An edit after reservation leaves the running execution's machine alone and applies next time.
  await svc.updateStory("DEV-1", { placement: { mode: "local-only" } }, user);
  const story = await svc.showStory("DEV-1", user);
  assert.equal(story.execution?.machineId, "a");
  await svc.moveStory("DEV-1", "in_progress", worker(req!.workerId));
  await svc.reportExecution(req!.execution!.id, { status: "terminal", outcome: "completed", evidence: "ended" });
  const next = spawns.find((s) => s.storyKey === "DEV-1" && s.stageId === "in_progress");
  assert.equal(next?.execution?.machineId, "local");
  assert.equal(next?.machine, undefined);
  assert.ok(!next?.brief.includes("The user specified"));
});

test("4+2+2 across Boards under concurrent requests, then local-only queues despite remote room", async () => {
  const { svc } = await setupProject({ config: { maxConcurrentWorkers: 1 } });
  await svc.updateProject(machines());
  await svc.createBoard("Quality", "QA");
  await svc.updateStage("QA", "todo", { promptEnabled: true, prompt: "Test it." });
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      svc.createStory(i % 2 ? "QA" : "DEV", { title: `S${i}`, stage: "todo" }, user),
    ),
  );
  // Concurrent mutations may publish the same intent twice (the store dedupes by key): count reservations.
  const count = (machine: string) => occupying(svc).filter((e) => e.machineId === machine).length;
  assert.deepEqual([count("a"), count("b"), count("local")], [4, 2, 2], "explicit caps, not a total of 1");
  assert.equal(svc.snapshot()!.runtime.queue.length, 2);
  const settings = await svc.updateProject({});
  assert.deepEqual(
    settings.machines.map((m) => `${m.id} ${m.used}/${m.capacity}`),
    ["local 2/2", "a 4/4", "b 2/2"],
  );
  // Free a remote slot: the oldest waiting Story takes it; a local-only Story still waits.
  const onA = occupying(svc).find((e) => e.machineId === "a")!;
  await svc.createStory("DEV", { title: "Local", stage: "todo", placement: { mode: "local-only" } }, user);
  await svc.forceRelease(onA.storyKey);
  await svc.reportExecution(onA.id, { status: "terminal", outcome: "completed", evidence: "ended" });
  assert.equal(count("a"), 4);
  assert.equal(svc.snapshot()!.runtime.queue.length, 2);
  const local = (await svc.listStories()).find((s) => s.title === "Local")!;
  assert.deepEqual(local.wait?.reasons, [{ machineId: "local", code: "capacity" }]);
});

// ---------- CLI ----------

const main = path.resolve(import.meta.dirname, "../src/cli/main.ts");

test("offline CLI: project set/show scheduling and story placement flags", () => {
  const project = tempDir();
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ["--import", "tsx", main, ...args, "--project", project], { encoding: "utf8" });
  const ok = (...args: string[]) => {
    const r = run(...args);
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  ok("board", "create", "Development", "--key", "DEV");
  assert.match(ok("project", "show"), /Scheduling: off.*\n {2}local {2}cap 3 \(maxConcurrentWorkers\) {2}used 0/);
  assert.match(ok("project", "set", "--max-workers", "4"), /cap 4/);
  const file = path.join(project, "scheduling.json");
  const remotesFile = path.join(project, "remotes.json");
  const catalog = remoteMachines();
  delete catalog[1]!.capacity;
  fs.writeFileSync(remotesFile, JSON.stringify(catalog));
  const listed = ok("project", "set", "--remote-machines-file", remotesFile);
  assert.match(listed, /Scheduling: off/);
  assert.match(listed, /a {2}"A" {2}enabled {2}cap 4 {2}used 0/);
  assert.match(listed, /b {2}"B" {2}enabled {2}cap 4 \(inherited\) {2}used 0/);
  fs.writeFileSync(file, JSON.stringify(scheduling()));
  const shown = ok("project", "set", "--scheduling-file", file);
  assert.match(shown, /Scheduling: per-machine/);
  assert.match(shown, /Order: a, b, local/);
  const json = JSON.parse(ok("project", "show", "--json")) as ProjectSettingsResponse;
  assert.deepEqual(json.config.scheduling, scheduling());
  assert.deepEqual(json.config.remoteMachines, catalog);
  assert.equal(json.config.maxConcurrentWorkers, 4);
  fs.writeFileSync(remotesFile, "{ nope");
  assert.match(run("project", "set", "--remote-machines-file", remotesFile).stderr, /not valid JSON/);

  fs.writeFileSync(file, "{ nope");
  assert.match(run("project", "set", "--scheduling-file", file).stderr, /not valid JSON/);
  fs.writeFileSync(file, JSON.stringify({ ...scheduling(), local: { capacity: "2" } }));
  assert.match(run("project", "set", "--scheduling-file", file).stderr, /scheduling\.local\.capacity/);
  assert.match(run("project", "set", "--max-workers", "-1").stderr, /--max-workers needs a nonnegative integer/);

  for (const [args, message] of [
    [["--placement", "required"], /needs --machine/],
    [["--placement", "local-only", "--machine", "a"], /takes no --machine/],
    [["--placement", "inherit", "--machine", "a"], /takes no --machine/],
    [["--machine", "a"], /--machine needs --placement/],
    [["--placement", "remote"], /--placement must be one of/],
    [["--placement", "required", "--machine", "zz"], /unknown remote "zz"/],
  ] as const) {
    const r = run("story", "create", "DEV", "--title", "Bad", ...args);
    assert.equal(r.status, 1);
    assert.match(r.stderr, message);
  }
  ok("story", "create", "DEV", "--title", "Pinned", "--placement", "required", "--machine", "a");
  assert.match(ok("story", "show", "DEV-1"), /^placement: required a$/m);
  ok("story", "update", "DEV-1", "--title", "Renamed");
  assert.match(ok("story", "show", "DEV-1"), /^placement: required a$/m, "omitting the flag preserves placement");
  ok("story", "update", "DEV-1", "--placement", "preferred", "--machine", "b");
  assert.match(ok("story", "show", "DEV-1"), /^placement: preferred b$/m);
  fs.writeFileSync(file, "null");
  fs.writeFileSync(remotesFile, "[]");
  assert.match(
    run("project", "set", "--scheduling-file", file, "--remote-machines-file", remotesFile).stderr,
    /DEV-1 has preferred placement on b/,
  );
  ok("story", "update", "DEV-1", "--placement", "inherit");
  assert.doesNotMatch(ok("story", "show", "DEV-1"), /placement:/);
  const off = ok("project", "set", "--scheduling-file", file, "--remote-machines-file", remotesFile);
  assert.match(off, /Scheduling: off/);
  assert.doesNotMatch(off, /Remote machines/);
});

test("online CLI and HTTP share validation; status --json reports per-machine usage", async () => {
  const root = tempRepo();
  const store = StoreService.create(root, null);
  const service = OnlineService.create(store, { root, sf: "sf" });
  const http = await listen(createApp({ store, service, token: "t", uiDir: null, onStop: () => {} }), 0);
  after(() => http.close());
  const address = http.address();
  const server: ServerInfo = { port: typeof address === "object" && address ? address.port : 0, token: "t", pid: 0 };
  const call = <T>(method: string, route: string, body?: unknown) => ClientService.api<T>(server, method, route, body);
  const cli = (...args: string[]) =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const proc = spawn(process.execPath, ["--import", "tsx", main, ...args, "--project", root]);
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d) => {
        stdout += d;
      });
      proc.stderr.on("data", (d) => {
        stderr += d;
      });
      proc.on("error", reject);
      proc.on("exit", (code) => resolve({ code, stdout, stderr }));
    });
  fs.mkdirSync(path.dirname(sfPaths(root).serverJson), { recursive: true });
  fs.writeFileSync(sfPaths(root).serverJson, JSON.stringify({ ...server, pid: process.pid }));
  await call("POST", routes.capabilities, {
    agent: "a",
    model: "m",
    app: "t3-code",
    canSpawnThreads: true,
    canSpawnSubagents: true,
  });
  await call("POST", routes.boards, { name: "Development", key: "DEV" });
  await call("PATCH", routes.stage("DEV", "todo"), { promptEnabled: true, prompt: "Work" });

  const file = path.join(tempDir(), "scheduling.json");
  const remotesFile = path.join(tempDir(), "remotes.json");
  fs.writeFileSync(file, JSON.stringify({ ...scheduling(), order: ["local"] }));
  fs.writeFileSync(remotesFile, JSON.stringify(remoteMachines()));
  assert.equal((await cli("project", "set", "--remote-machines-file", remotesFile, "--scheduling-file", file)).code, 0);
  const settings = await call<ProjectSettingsResponse>("GET", routes.projectSettings);
  assert.deepEqual(settings.config.scheduling?.order, ["local"]);
  const created = await cli(
    "story",
    "create",
    "DEV",
    "--title",
    "Remote",
    "--stage",
    "todo",
    "--placement",
    "required",
    "--machine",
    "b",
    "--json",
  );
  assert.equal(created.code, 0, created.stderr);
  const story = JSON.parse(created.stdout) as StoryDetails;
  assert.deepEqual(story.placement, { mode: "required", machineId: "b" });
  assert.equal(story.execution?.machineId, "b");
  const shown = await cli("story", "show", story.key);
  assert.match(shown.stdout, /^placement: required b$/m);
  assert.match(shown.stdout, /^execution: x-\w+ requested machine b, reserved$/m);
  assert.match((await cli("story", "list")).stdout, /requested b/);

  // HTTP rejects the same invalid and orphaning writes the service does.
  await assert.rejects(
    call("PATCH", routes.projectSettings, { remoteMachines: [] }),
    /DEV-1 has required placement on b/,
  );
  await assert.rejects(call("PATCH", routes.projectSettings, { maxConcurrentWorkers: "2" }), /maxConcurrentWorkers/);
  const rejected = await cli("story", "update", story.key, "--placement", "preferred", "--machine", "zz");
  assert.equal(rejected.code, 1);
  assert.match(rejected.stderr, /unknown remote "zz"/);

  const status = JSON.parse((await cli("status", "--json")).stdout);
  assert.deepEqual(Object.keys(status), ["server", "commands", "claims", "occupying", "waiting", "machines"]);
  assert.equal(status.occupying, 1);
  assert.deepEqual(
    status.machines.map((m: { id: string; used: number; capacity: number }) => `${m.id} ${m.used}/${m.capacity}`),
    ["local 0/2", "a 0/4", "b 1/2"],
  );
  assert.match((await cli("status")).stdout, /machines: local 0\/2, a 0\/4, b 1\/2/);
  fs.rmSync(sfPaths(root).serverJson);
  assert.equal((await cli("status")).stdout.trim(), "not running");
});
