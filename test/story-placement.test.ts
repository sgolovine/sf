import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { normalizePlacementPolicy, selectPlacement } from "#model/placement";
import { loadBoard, loadProjectConfig } from "../src/server/project/config.ts";
import { sfPaths } from "../src/server/project/paths.ts";
import { setupProject, user } from "./helpers.ts";
import { scheduling } from "./scheduling-fixture.ts";

for (const online of [true, false]) {
  test(`placement service validation, persistence and stale recovery (online=${online})`, async () => {
    const { svc, root, make } = await setupProject({ online, config: { scheduling: scheduling() } });
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
    const reduced = scheduling();
    reduced.remotes = reduced.remotes.filter((r) => r.id !== "a");
    reduced.order = ["b", "local"];
    fs.writeFileSync(configFile, JSON.stringify({ ...config, scheduling: reduced }));
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
    const disabled = scheduling();
    disabled.remotes[0]!.enabled = false;
    fs.writeFileSync(configFile, JSON.stringify({ ...config, scheduling: disabled }));
    assert.deepEqual((await svc.updateStory(key, { placement }, user)).placement, placement);
    const { scheduling: _scheduling, ...legacy } = config;
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
      null,
      {},
      { ...scheduling(), local: { capacity: -1 } },
      { ...scheduling(), order: ["missing"] },
    ]) {
      fs.writeFileSync(file, JSON.stringify({ ...legacy, scheduling: bad }));
      assert.throws(() => loadProjectConfig(root), { code: "invalid" });
      assert.throws(() => svc.snapshot(), { code: "invalid" });
      await assert.rejects(svc.createStory("DEV", { title: "Bad" }, user), { code: "invalid" });
    }
    fs.writeFileSync(file, JSON.stringify({ ...legacy, scheduling: scheduling() }));
    assert.deepEqual(svc.snapshot()?.config.scheduling, scheduling());
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

test("scheduling replaces the legacy cap; a required remote is requested from the harness", async () => {
  const config = scheduling();
  config.remotes[0]!.capacity = 1;
  const { svc, spawns } = await setupProject({ config: { maxConcurrentWorkers: 1, scheduling: config } });
  await svc.createStory("DEV", { title: "One", stage: "todo", placement: { mode: "required", machineId: "a" } }, user);
  await svc.createStory("DEV", { title: "Two", stage: "todo" }, user);
  await svc.createStory("DEV", { title: "Three", stage: "todo" }, user);
  await svc.createStory("DEV", { title: "Four", stage: "todo" }, user);
  // Inherit follows the order past the full remote a to b, at per-machine caps instead of the legacy total.
  assert.deepEqual(
    spawns.map((s) => `${s.storyKey}@${s.execution?.machineId}:${s.machine?.placement}`),
    ["DEV-1@a:required", "DEV-2@b:default", "DEV-3@b:default", "DEV-4@local:undefined"],
  );
});
