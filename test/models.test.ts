import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { MODEL_PRESETS, modelCatalog, resolveModel } from "#model/models";
import {
  DEFAULT_PROJECT_CONFIG,
  defaultBoard,
  loadBoard,
  loadProjectConfig,
  validateSchema,
} from "../src/server/project/config.ts";
import { sfPaths } from "../src/server/project/paths.ts";
import { createService } from "../src/server/project/service.ts";
import { readStage } from "../src/server/project/stage.ts";
import { parseStory, serializeStory } from "../src/server/project/story.ts";
import { setupProject, user, worker } from "./helpers.ts";

test("model precedence and clearing each level, with unchanged agent inheritance", async () => {
  const { svc, root } = await setupProject();
  await svc.updateProject({ model: "project" });
  await svc.updateBoard("DEV", { model: "board" });
  await svc.updateStage("DEV", "backlog", { model: "stage" });
  const s = await svc.createStory("DEV", { title: "Precedence", model: "story" }, user);
  assert.deepEqual(s.effectiveModel, { model: "story", source: "story" });
  assert.deepEqual((await svc.updateStory(s.key, { model: "" }, user)).effectiveModel, {
    model: "stage",
    source: "stage",
  });
  await svc.updateStage("DEV", "backlog", { model: null });
  assert.deepEqual((await svc.showStory(s.key, user)).effectiveModel, { model: "board", source: "board" });
  await svc.updateBoard("DEV", { model: null });
  assert.deepEqual((await svc.showStory(s.key, user)).effectiveModel, { model: "project", source: "project" });
  await svc.updateProject({ model: null });
  assert.deepEqual((await svc.showStory(s.key, user)).effectiveModel, { model: null, source: "supervisor" });
  const config = loadBoard(root, "development");
  assert.equal(config.stages[0]!.model, undefined);
  assert.equal(
    parseStory(fs.readFileSync(path.join(sfPaths(root).stories("development"), `${s.key}.md`), "utf8")).model,
    undefined,
  );
});

test("every preset and custom slug persists at all levels and reaches Worker unchanged", async () => {
  const slugs = [
    "gpt-6.1-sol",
    "claude-opus-5-5",
    "claude-fable-5-1",
    "claude-haiku-5-5",
    "gpt-6-luna",
    "gpt-6.1-terra",
    "gpt-6-astra",
    "vendor/Custom-123",
  ];
  assert.deepEqual(
    MODEL_PRESETS.map((o) => o.slug),
    slugs.slice(0, 7),
  );
  const { svc, root, spawns } = await setupProject();
  for (const slug of slugs) {
    await svc.updateProject({ model: slug, addModelOptions: [{ slug, label: slug }] });
    await svc.updateBoard("DEV", { model: slug, addModelOptions: [{ slug, label: "Board label" }] });
    await svc.updateStage("DEV", "todo", { model: slug });
    const story = await svc.createStory("DEV", { title: slug, stage: "todo", model: slug }, user);
    assert.equal(spawns.at(-1)!.model, slug);
    assert.match(spawns.at(-1)!.brief, /Worker model: .* \(from story\)/);
    assert.equal(loadProjectConfig(root).worker.model, slug);
    assert.equal(loadBoard(root, "development").overrides.worker?.model, slug);
    assert.equal(loadBoard(root, "development").stages.find((s) => s.id === "todo")!.model, slug);
    assert.equal((await svc.showStory(story.key, user)).model, slug);
    await svc.releaseStory(story.key, worker(spawns.at(-1)!.workerId));
  }
  const p = svc.showProject();
  const b = svc.showBoard("DEV");
  assert.equal(p.modelOptions.find((o) => o.slug === slugs[7])!.label, slugs[7]);
  assert.equal(b.modelOptions.find((o) => o.slug === slugs[7])!.label, "Board label");
  assert.equal(b.modelOptions[0]!.label, "GPT 6.1 Sol");
  await svc.updateBoard("DEV", { modelOptions: [] });
  assert.equal((await svc.showStory("DEV-8", user)).model, slugs[7]);
});

test("catalog merge, unknown selections, and invalid entries", async () => {
  const { svc } = await setupProject();
  await svc.updateProject({
    modelOptions: [
      { slug: "custom", label: "Project" },
      { slug: "extra", label: "Extra" },
    ],
  });
  await svc.updateBoard("DEV", {
    modelOptions: [
      { slug: "custom", label: "Board" },
      { slug: "gpt-6.1-sol", label: "Spoof" },
    ],
  });
  const options = svc.showBoard("DEV").modelOptions;
  assert.equal(options.filter((o) => o.slug === "custom").length, 1);
  assert.equal(options.find((o) => o.slug === "custom")!.label, "Board");
  assert.equal(options[0]!.label, "GPT 6.1 Sol");
  assert.ok(options.some((o) => o.slug === "extra"));
  await svc.updateProject({ modelOptions: [{ slug: "no-label" } as never] });
  assert.equal(svc.showProject().config.modelOptions![0]!.label, "no-label");
  for (const slug of ["", " space", "space ", "with space"]) {
    await assert.rejects(svc.updateProject({ addModelOptions: [{ slug, label: slug }] }), /slug/);
    if (slug) await assert.rejects(svc.updateBoard("DEV", { model: slug }), /slug/);
  }
  await assert.rejects(svc.updateProject({ modelOptions: {} as never }), /array/);
  const story = await svc.createStory("DEV", { title: "Unknown", model: "unknown-model" }, user);
  assert.ok(story.modelOptions!.some((o) => o.slug === "unknown-model"));
});

test("Stage models migrate lazily, frontmatter wins, clear removes legacy value and prompt excludes metadata", async () => {
  const { svc, root, spawns } = await setupProject();
  const paths = sfPaths(root);
  const file = paths.board("development");
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  raw.extra = { nested: 42 };
  raw.stages.find((s: { id: string }) => s.id === "todo").model = "legacy";
  fs.writeFileSync(file, JSON.stringify(raw));
  const stageFile = path.join(paths.stages("development"), "todo.md");
  fs.writeFileSync(stageFile, "---\ncustom: preserved\n---\nOld prompt\n");
  assert.equal(loadBoard(root, "development").stages[1]!.model, "legacy");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).stages[1].model, "legacy");
  await svc.updateStage("DEV", "todo", { prompt: "New prompt\n" });
  assert.equal(readStage(stageFile).metadata.model, "legacy");
  assert.equal(readStage(stageFile).metadata.custom, "preserved");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).stages[1].model, undefined);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).extra.nested, 42);
  const s = await svc.createStory("DEV", { title: "Migrated", stage: "todo" }, user);
  assert.equal(spawns[0]!.model, "legacy");
  assert.match(spawns[0]!.brief, /## Stage Prompt\n\nNew prompt/);
  assert.doesNotMatch(spawns[0]!.brief, /custom: preserved/);
  await svc.releaseStory(s.key, worker(spawns[0]!.workerId));
  // Explicit null/empty beats JSON even before migration.
  for (const value of ["null", '""', '"frontmatter"']) {
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    config.stages[1].model = "stale";
    fs.writeFileSync(file, JSON.stringify(config));
    fs.writeFileSync(stageFile, `---\nmodel: ${value}\ncustom: preserved\n---\nPrompt\n`);
    assert.equal(loadBoard(root, "development").stages[1]!.model, value === '"frontmatter"' ? "frontmatter" : null);
    await svc.updateStage("DEV", "todo", { model: "" });
    assert.equal(readStage(stageFile).metadata.model, undefined);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).stages[1].model, undefined);
    assert.equal(loadBoard(root, "development").stages[1]!.model, undefined);
  }
  await svc.updateStage("DEV", "done", { model: "metadata-only" });
  assert.equal(readStage(path.join(paths.stages("development"), "done.md")).body, "");
});

test("current Stage governs Moves, Story overrides survive, and no selection omits spawn model", async () => {
  const { svc, spawns } = await setupProject();
  await svc.updateStage("DEV", "todo", { model: "plan" });
  await svc.updateStage("DEV", "in_progress", { model: "build" });
  const s = await svc.createStory("DEV", { title: "Move", stage: "todo" }, user);
  await svc.moveStory(s.key, "in_progress", worker(spawns[0]!.workerId));
  assert.equal(spawns[1]!.model, "build");
  await svc.updateStory(s.key, { model: "explicit" }, user);
  assert.equal(spawns.length, 2);
  await svc.moveStory(s.key, "todo", worker(spawns[1]!.workerId));
  assert.equal(spawns[2]!.model, "explicit");
  await svc.updateStory(s.key, { model: null }, user);
  await svc.updateStage("DEV", "in_progress", { model: null });
  await svc.moveStory(s.key, "in_progress", worker(spawns[2]!.workerId));
  assert.equal(Object.hasOwn(spawns[3]!, "model"), false);
  assert.match(spawns[3]!.brief, /Worker model: Supervisor default/);
});

test("queued, offline, retry and HIL spawns resolve current persisted settings", async () => {
  const { svc, root, spawns, make } = await setupProject({ config: { maxConcurrentWorkers: 1 } });
  const first = await svc.createStory("DEV", { title: "First", stage: "todo" }, user);
  await svc.createStory("DEV", { title: "Queued", stage: "todo" }, user);
  await svc.updateProject({ model: "fresh-queue" });
  await svc.releaseStory(first.key, worker(spawns[0]!.workerId));
  assert.equal(spawns[1]!.model, "fresh-queue");
  await svc.spawnResult(spawns[1]!.workerId, false, "Failed");
  await svc.updateProject({ model: "fresh-retry" });
  await svc.retry("DEV-2");
  assert.equal(spawns[2]!.model, "fresh-retry");
  await svc.releaseStory("DEV-2", worker(spawns[2]!.workerId));
  await make(false).createStory("DEV", { title: "Offline", stage: "todo" }, user);
  await svc.updateProject({ model: "fresh-offline" });
  await svc.drainPending();
  assert.equal(spawns[3]!.model, "fresh-offline");
  await svc.releaseStory("DEV-3", worker(spawns[3]!.workerId));
  await svc.updateBoard("DEV", { schema: [{ id: "hil", name: "HIL", type: "boolean" }] });
  await svc.updateStage("DEV", "todo", { hilFlag: "hil" });
  const held = await svc.createStory("DEV", { title: "Held", stage: "todo", fields: { hil: true } }, user);
  await svc.updateProject({ model: "fresh-hil" });
  await svc.updateStory(held.key, { fields: { hil: false } }, user);
  assert.equal(spawns[4]!.model, "fresh-hil");
  assert.equal(createService({ root, online: false }).showProject().effectiveModel.model, "fresh-hil");
});

test("built-in model is protected and legacy custom data remains separate and intact", async () => {
  const { svc, root } = await setupProject();
  assert.throws(() => validateSchema([{ id: "model", name: "Model", type: "text" }]), /reserved/);
  const paths = sfPaths(root);
  const file = paths.board("development");
  const board = JSON.parse(fs.readFileSync(file, "utf8"));
  board.schema.push({ id: "model", name: "Legacy Model", type: "number" });
  fs.writeFileSync(file, JSON.stringify(board));
  const storyFile = path.join(paths.stories("development"), "DEV-1.md");
  fs.writeFileSync(storyFile, "---\ntitle: Legacy\nstage: backlog\nmodel: 42\nunknown: kept\n---\nBody\n");
  const before = fs.readFileSync(storyFile, "utf8");
  const s = await svc.showStory("DEV-1", user);
  assert.equal(s.model, undefined);
  assert.equal(s.fields.model, 42);
  assert.equal(s.effectiveModel!.source, "supervisor");
  assert.equal(svc.snapshot()!.boards[0]!.stories[0]!.fields.model, 42);
  assert.equal(fs.readFileSync(storyFile, "utf8"), before);
  await assert.rejects(svc.updateBoard("DEV", { schema: [] }), /rename/);
  await assert.rejects(svc.updateStory("DEV-1", { model: "new" }, user), /rename/);
  await svc.updateStory("DEV-1", { title: "Edited" }, user);
  assert.match(fs.readFileSync(storyFile, "utf8"), /model: 42/);
  await svc.updateBoard("DEV", { model: "board-default" });
  assert.equal((await svc.showStory("DEV-1", user)).fields.model, 42);
  const legacyText = parseStory("---\ntitle: Text\nstage: backlog\nmodel: legacy-text\n---\n", true);
  assert.equal(legacyText.model, undefined);
  assert.equal(legacyText.fields.model, "legacy-text");
  assert.match(serializeStory(legacyText), /model: legacy-text/);
});

test("patches preserve unknown JSON keys, nested Worker settings, YAML metadata and old configs", async () => {
  const { svc, root } = await setupProject();
  const paths = sfPaths(root);
  const p = JSON.parse(fs.readFileSync(paths.config, "utf8"));
  p.unknown = 9;
  p.worker.extra = "kept";
  fs.writeFileSync(paths.config, JSON.stringify(p));
  const b = JSON.parse(fs.readFileSync(paths.board("development"), "utf8"));
  b.unknown = [1];
  b.overrides = { worker: { agent: "agent", extra: "kept" }, worktree: { baseBranch: "base", extra: 2 }, extra: 3 };
  fs.writeFileSync(paths.board("development"), JSON.stringify(b));
  await svc.updateProject({ model: "project" });
  await svc.updateBoard("DEV", { overrides: { worker: { model: "board" } } });
  const after = JSON.parse(fs.readFileSync(paths.board("development"), "utf8"));
  assert.deepEqual(after.unknown, [1]);
  assert.equal(after.overrides.worker.agent, "agent");
  assert.equal(after.overrides.worker.extra, "kept");
  assert.equal(after.overrides.worktree.extra, 2);
  assert.equal(after.overrides.extra, 3);
  const project = JSON.parse(fs.readFileSync(paths.config, "utf8"));
  assert.equal(project.unknown, 9);
  assert.equal(project.worker.extra, "kept");
  assert.deepEqual(resolveModel(DEFAULT_PROJECT_CONFIG, defaultBoard("Old", "OLD")), {
    model: null,
    source: "supervisor",
  });
  assert.equal(modelCatalog(DEFAULT_PROJECT_CONFIG).length, 7);
});

test("malformed selections cannot overwrite Stage or incompatible Story metadata", async () => {
  const { svc, root } = await setupProject();
  await svc.updateStage("DEV", "todo", { model: "kept" });
  await assert.rejects(svc.updateStage("DEV", "todo", { model: false as never }), /slug/);
  assert.equal(svc.showBoard("DEV").config.stages[1]!.model, "kept");
  const file = path.join(sfPaths(root).stories("development"), "DEV-1.md");
  fs.writeFileSync(file, "---\ntitle: Unknown metadata\nstage: backlog\nmodel: 42\nnullable: null\n---\n");
  const story = await svc.showStory("DEV-1", user);
  assert.equal(story.model, undefined);
  assert.equal(story.fields.model, 42);
  await assert.rejects(svc.updateStory(story.key, { model: "overwrite" }, user), /rename/);
  await svc.updateStory(story.key, { title: "Edited safely" }, user);
  const saved = parseStory(fs.readFileSync(file, "utf8"));
  assert.equal(saved.fields.model, 42);
  assert.equal(saved.fields.nullable, null);
});
