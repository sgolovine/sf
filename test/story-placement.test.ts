import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { normalizePlacementPolicy, selectPlacement } from "#model/placement";
import { loadBoard, loadProjectConfig } from "../src/server/project/config.ts";
import { sfPaths } from "../src/server/project/paths.ts";
import { setupProject, user } from "./helpers.ts";
import { legacyScheduling, machines, remoteMachines, scheduling } from "./scheduling-fixture.ts";

for (const online of [true, false]) {
  test(`placement service validation, persistence and stale recovery (online=${online})`, async () => {
    const { svc, root, make } = await setupProject({ online, config: machines() });
    const placement = { mode: "preferred", machineId: "a" } as const;
    const created = await svc.createStory("DEV", { title: "One", placement, fields: { extra: "kept" } }, user);
    assert.deepEqual(created.placement, placement);
    const key = created.key;
    await svc.updateStory(key, { title: "New", body: "Body", fields: { extra: "edited" } }, user);
    await svc.moveStory(key, "in_review", user);
    const reloaded = await make(online).showStory(key, user);
    assert.deepEqual(reloaded.placement, placement);
    assert.deepEqual(reloaded.fields, { extra: "edited" });
    assert.deepEqual(make(online).snapshot()?.boards[0]?.stories[0]?.placement, placement);
    const malformed: unknown[] = [
      { mode: "required", machineId: "missing" },
      { mode: "required", machineId: "local" },
      { mode: "required" },
      { mode: "preferred", machineId: 1 },
      { mode: "inherit", machineId: "a" },
      { mode: "local-only", machineId: "a" },
      { mode: "other" },
      [],
      "a",
      { mode: "required", machineId: "a", extra: 1 },
    ];
    for (const value of malformed) {
      await assert.rejects(svc.createStory("DEV", { title: "Bad", placement: value } as never, user), {
        code: "invalid",
      });
      await assert.rejects(svc.updateStory(key, { placement: value } as never, user), { code: "invalid" });
    }
    for (const fields of [{ placement: null }, { title: "bad" }, { stage: "done" }, { branch: "bad" }]) {
      await assert.rejects(svc.createStory("DEV", { title: "Bad", fields }, user), /built-in/);
      await assert.rejects(svc.updateStory(key, { fields }, user), /built-in/);
    }
    const configFile = sfPaths(root).config;
    const config = loadProjectConfig(root);
    const reduced = remoteMachines().filter((r) => r.id !== "a");
    fs.writeFileSync(
      configFile,
      JSON.stringify({ ...config, remoteMachines: reduced, scheduling: { ...scheduling(), order: ["b", "local"] } }),
    );
    assert.deepEqual((await svc.updateStory(key, { title: "Stale but editable" }, user)).placement, placement);
    assert.deepEqual(
      selectPlacement(normalizePlacementPolicy(loadProjectConfig(root)), { mode: "required", machineId: "a" }, {}, {}),
      { kind: "wait", reasons: [{ machineId: "a", code: "missing-target" }] },
    );
    await assert.rejects(svc.updateStory(key, { placement }, user), /unknown remote/);
    for (const clear of [null, { mode: "inherit" }] as const) {
      assert.equal((await svc.updateStory(key, { placement: clear }, user)).placement, undefined);
      assert.doesNotMatch(fs.readFileSync(`${sfPaths(root).stories("development")}/${key}.md`, "utf8"), /placement:/);
      fs.writeFileSync(configFile, JSON.stringify(config));
      await svc.updateStory(key, { placement }, user);
    }
    const disabled = remoteMachines();
    disabled[0]!.enabled = false;
    fs.writeFileSync(configFile, JSON.stringify({ ...config, remoteMachines: disabled }));
    assert.deepEqual((await svc.updateStory(key, { placement }, user)).placement, placement);
    // Remote placement needs only the catalog, not scheduling.
    const { scheduling: _scheduling, ...unscheduled } = config;
    fs.writeFileSync(configFile, JSON.stringify(unscheduled));
    assert.deepEqual((await svc.updateStory(key, { placement }, user)).placement, placement);
    const { remoteMachines: _remotes, ...legacy } = unscheduled;
    fs.writeFileSync(configFile, JSON.stringify(legacy));
    await assert.rejects(svc.createStory("DEV", { title: "Remote", placement }, user), /unknown remote/);
    await assert.rejects(svc.updateStory(key, { placement }, user), /unknown remote/);
    assert.equal((await svc.updateStory(key, { placement: null }, user)).placement, undefined);
    const local = await svc.createStory("DEV", { title: "Local", placement: { mode: "local-only" } }, user);
    assert.deepEqual(local.placement, { mode: "local-only" });
    assert.equal(
      (await svc.createStory("DEV", { title: "Inherit", placement: { mode: "inherit" } }, user)).placement,
      undefined,
    );
  });

  test(`file-loaded scheduling rejects invalid data through service (online=${online})`, async () => {
    const { root, svc } = await setupProject({ online });
    const file = sfPaths(root).config;
    const legacy = loadProjectConfig(root);
    assert.equal(legacy.maxConcurrentWorkers, 3);
    for (const bad of [
      { scheduling: null },
      { scheduling: {} },
      { ...machines(), scheduling: { ...scheduling(), local: { capacity: -1 } } },
      { ...machines(), scheduling: { ...scheduling(), order: ["missing"] } },
      { scheduling: scheduling() },
      { remoteMachines: {} },
      { remoteMachines: [{ id: "a", name: " ", enabled: true }] },
      { remoteMachines: [], scheduling: legacyScheduling() },
    ]) {
      fs.writeFileSync(file, JSON.stringify({ ...legacy, ...bad }));
      assert.throws(() => loadProjectConfig(root), { code: "invalid" });
      assert.throws(() => svc.snapshot(), { code: "invalid" });
      await assert.rejects(svc.createStory("DEV", { title: "Bad" }, user), { code: "invalid" });
    }
    fs.writeFileSync(file, JSON.stringify({ ...legacy, ...machines() }));
    assert.deepEqual(svc.snapshot()?.config.scheduling, scheduling());
    assert.deepEqual(svc.snapshot()?.config.remoteMachines, remoteMachines());
    const boardFile = sfPaths(root).board("development");
    const board = loadBoard(root, "development");
    fs.writeFileSync(
      boardFile,
      JSON.stringify({ ...board, schema: [{ id: "placement", name: "Legacy placement", type: "text" }] }),
    );
    assert.throws(() => loadBoard(root, "development"), /rename the legacy custom field/);
    fs.writeFileSync(boardFile, JSON.stringify({ ...board, overrides: { scheduling: scheduling() } }));
    assert.throws(() => loadBoard(root, "development"), /Project-wide/);
  });
}

test("scheduling uses per-machine caps; a required remote is requested from the harness", async () => {
  const config = machines();
  config.remoteMachines[0]!.capacity = 1;
  const { svc, spawns } = await setupProject({ config: { maxConcurrentWorkers: 1, ...config } });
  await svc.createStory("DEV", { title: "One", stage: "todo", placement: { mode: "required", machineId: "a" } }, user);
  await svc.createStory("DEV", { title: "Two", stage: "todo" }, user);
  await svc.createStory("DEV", { title: "Three", stage: "todo" }, user);
  await svc.createStory("DEV", { title: "Four", stage: "todo" }, user);
  // Inherit follows the order past the full remote a to b, at per-machine caps, not one total.
  assert.deepEqual(
    spawns.map((s) => `${s.storyKey}@${s.execution?.machineId}:${s.machine?.id}`),
    ["DEV-1@a:a", "DEV-2@b:b", "DEV-3@b:b", "DEV-4@local:undefined"],
  );
});

test("without scheduling, remotes are reached only by placement; inherited capacity follows the maximum", async () => {
  const remotes = remoteMachines().map(({ capacity: _, ...r }) => r);
  const { svc, spawns } = await setupProject({ config: { maxConcurrentWorkers: 1, remoteMachines: remotes } });
  const required = { mode: "required", machineId: "a" } as const;
  for (const title of ["One", "Two"]) await svc.createStory("DEV", { title, stage: "todo", placement: required }, user);
  for (const title of ["Three", "Four"]) await svc.createStory("DEV", { title, stage: "todo" }, user);
  await svc.createStory(
    "DEV",
    { title: "Five", stage: "todo", placement: { mode: "preferred", machineId: "b" } },
    user,
  );
  // a and local inherit cap 1; preferred b has room. Inherited Stories never route to a remote on their own.
  assert.deepEqual(
    spawns.map((s) => `${s.storyKey}@${s.execution?.machineId}`),
    ["DEV-1@a", "DEV-3@local", "DEV-5@b"],
  );
  assert.ok(spawns[0]!.brief.includes("The user specified that this work should be done on the machine: a"));
  assert.ok(!spawns[1]!.brief.includes("The user specified"));
  // Raising the Project maximum raises every inherited cap and drains the queue.
  await svc.updateProject({ maxConcurrentWorkers: 2 });
  assert.deepEqual(
    spawns.map((s) => `${s.storyKey}@${s.execution?.machineId}`),
    ["DEV-1@a", "DEV-3@local", "DEV-5@b", "DEV-2@a", "DEV-4@local"],
  );
  // An explicit override replaces inheritance; clearing it restores it.
  const shown = await svc.updateProject({ remoteMachines: [{ ...remotes[0]!, capacity: 0 }, remotes[1]!] });
  assert.equal(shown.policy.machines.a?.capacity, 0);
  const cleared = await svc.updateProject({ remoteMachines: remotes });
  assert.equal(cleared.policy.machines.a?.capacity, 2);
  assert.equal(Object.hasOwn(cleared.config.remoteMachines![0]!, "capacity"), false);
});
