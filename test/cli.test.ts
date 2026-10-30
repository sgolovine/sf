import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "./helpers.ts";

const main = path.resolve(import.meta.dirname, "../src/cli/main.ts");
const sf = (...args: string[]) =>
  spawnSync(process.execPath, ["--import", "tsx", main, ...args], {
    encoding: "utf8",
    env: { ...process.env, SF_PROJECT: tempDir() },
  });

test("--help lists setup and start", () => {
  const r = sf("--help");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /sf setup/);
  assert.match(r.stdout, /sf start/);
});

test("--version prints sf <version>", () => {
  const r = sf("--version");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^sf \d/);
});

test("an unknown command exits 1", () => {
  assert.equal(sf("nope").status, 1);
});

test("setup installs only the skill's markdown", () => {
  const dir = tempDir();
  const r = sf("setup", "--agents", "claude-code", "--scope", "project", "--project-dir", dir, "--yes");
  assert.equal(r.status, 0, r.stderr);
  const skill = path.join(dir, ".claude/skills/sf");
  assert.ok(fs.existsSync(path.join(skill, "SKILL.md")));
  assert.ok(fs.existsSync(path.join(skill, "references/commands.md")));
  assert.ok(!fs.existsSync(path.join(skill, "scripts")));
  assert.ok(!fs.existsSync(path.join(skill, "assets")));
});

test("stage set --hil-flag/--hil-comment set and clear a Stage's HIL fields", () => {
  const project = tempDir();
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ["--import", "tsx", main, ...args, "--project", project], { encoding: "utf8" });
  assert.equal(run("board", "create", "Development", "--key", "DEV").status, 0);
  const file = path.join(project, ".sf/boards/development/board.config.json");
  const board = JSON.parse(fs.readFileSync(file, "utf8"));
  board.schema = [
    { id: "dev_hil", name: "Dev HIL", type: "boolean" },
    { id: "dev_hil_comment", name: "Dev HIL comment", type: "text" },
  ];
  fs.writeFileSync(file, JSON.stringify(board));
  const hil = () => JSON.parse(fs.readFileSync(file, "utf8")).stages.find((s: { id: string }) => s.id === "todo").hil;

  const set = run("stage", "set", "DEV", "todo", "--hil-flag", "dev_hil", "--hil-comment", "dev_hil_comment");
  assert.equal(set.status, 0, set.stderr);
  assert.match(set.stdout, /HIL dev_hil \/ dev_hil_comment/);
  assert.deepEqual(hil(), { flag: "dev_hil", comment: "dev_hil_comment" });
  assert.equal(run("stage", "set", "DEV", "todo", "--hil-comment", "").status, 0);
  assert.deepEqual(hil(), { flag: "dev_hil" });
  const bad = run("stage", "set", "DEV", "todo", "--hil-flag", "dev_hil_comment");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /must be a boolean field/);
  assert.equal(run("stage", "set", "DEV", "todo", "--hil-flag", "").status, 0);
  assert.equal(hil(), undefined);
});

test("offline model commands round-trip Project, Board, Stage and built-in Story selections", () => {
  const project = tempDir();
  const run = (...args: string[]) => {
    const r = spawnSync(process.execPath, ["--import", "tsx", main, ...args, "--project", project, "--json"], {
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  run("init");
  run("board", "create", "Development", "--key", "DEV");
  const p = run(
    "project",
    "set",
    "--model",
    "project-slug",
    "--model-option",
    "custom/one",
    "--model-option",
    "custom/two",
  );
  assert.deepEqual(p.effectiveModel, { model: "project-slug", source: "project" });
  assert.equal(run("project", "show").config.modelOptions.length, 2);
  run("project", "set", "--model-option", "custom/three");
  assert.equal(run("project", "show").config.modelOptions.length, 3);
  run("board", "set", "DEV", "--model", "board-slug", "--model-option", "board/custom");
  assert.equal(run("board", "show", "DEV").effectiveModel.model, "board-slug");
  const stage = run("stage", "set", "DEV", "backlog", "--model", "stage-slug");
  assert.equal(stage.effectiveModel.source, "stage");
  const s = run("story", "create", "DEV", "--title", "Models", "--model", "story-slug");
  assert.equal(run("story", "show", s.key).effectiveModel.source, "story");
  run("story", "update", s.key, "--model", "");
  assert.equal(run("story", "show", s.key).effectiveModel.source, "stage");
  run("stage", "set", "DEV", "backlog", "--model", "");
  assert.equal(run("story", "show", s.key).effectiveModel.source, "board");
  run("board", "set", "DEV", "--model", "");
  assert.equal(run("story", "show", s.key).effectiveModel.source, "project");
  run("project", "set", "--model", "");
  assert.equal(run("story", "show", s.key).effectiveModel.source, "supervisor");
});

test("story delete offline accepts project/json and rejects stale Workers and missing Stories", () => {
  const project = tempDir();
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ["--import", "tsx", main, ...args, "--project", project, "--json"], {
      encoding: "utf8",
    });
  assert.equal(run("board", "create", "Development", "--key", "DEV").status, 0);
  assert.equal(run("story", "create", "DEV", "--title", "Delete").status, 0);
  const stale = run("story", "delete", "DEV-1", "--worker", "stale");
  assert.equal(stale.status, 3);
  assert.match(stale.stderr, /claim is gone/);
  const deleted = run("story", "delete", "DEV-1");
  assert.equal(deleted.status, 0, deleted.stderr);
  assert.deepEqual(JSON.parse(deleted.stdout), { key: "DEV-1" });
  assert.deepEqual(JSON.parse(run("story", "list").stdout), []);
  const repeated = run("story", "delete", "DEV-1");
  assert.equal(repeated.status, 1);
  assert.match(repeated.stderr, /no Story DEV-1/);
  assert.equal(JSON.parse(run("story", "create", "DEV", "--title", "Next").stdout).key, "DEV-2");
});
