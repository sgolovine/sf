import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardConfig } from "#model/config";
import { DEFAULT_PROJECT_CONFIG, defaultBoard, resolveSettings, slug, uniqueId, validateBoard } from "../src/server/project/config.ts";

test("default Board has the five Stages", () => {
  const board = defaultBoard("Development", "DEV");
  assert.deepEqual(
    board.stages.map((s) => [s.id, s.name]),
    [
      ["backlog", "Backlog"],
      ["todo", "TODO"],
      ["in_progress", "In Progress"],
      ["in_review", "In Review"],
      ["done", "Done"],
    ],
  );
  validateBoard(board);
});

test("slug and uniqueId", () => {
  assert.equal(slug("Ready for Development!"), "ready_for_development");
  assert.equal(uniqueId("todo", ["todo", "todo_2"]), "todo_3");
});

test("resolveSettings: Stage over Board over Project", () => {
  const project = { ...DEFAULT_PROJECT_CONFIG, worker: { agent: "codex", model: "p-model" } };
  const board: BoardConfig = {
    ...defaultBoard("Dev", "DEV"),
    overrides: { worker: { model: "b-model" }, worktree: { baseBranch: "develop" }, claimTimeoutMinutes: 60, briefPreamble: "B" },
  };
  const stage = { id: "todo", name: "TODO", promptEnabled: true, model: "s-model" };
  assert.deepEqual(resolveSettings(project, board, stage), {
    agent: "codex",
    model: "s-model",
    baseBranch: "develop",
    claimTimeoutMinutes: 60,
    briefPreamble: "B",
    maxConcurrentWorkers: 3,
  });
  assert.equal(resolveSettings(project, board).model, "b-model");
  assert.equal(resolveSettings(project).model, "p-model");
});

test("validateBoard rejects bad boards", () => {
  const ok = defaultBoard("Dev", "DEV");
  assert.throws(() => validateBoard({ ...ok, overrides: { maxConcurrentWorkers: 5 } as never }), /Project-wide/);
  assert.throws(() => validateBoard({ ...ok, stages: ok.stages.slice(1) }), /Backlog/);
  assert.throws(() => validateBoard({ ...ok, key: "dev" }), /uppercase/);
  assert.throws(
    () => validateBoard({ ...ok, stages: ok.stages.map((s) => (s.id === "done" ? { ...s, promptEnabled: true } : s)) }),
    /Stage Prompt/,
  );
  assert.throws(() => validateBoard({ ...ok, schema: [{ id: "title", name: "T", type: "text" }] }), /reserved/);
});
