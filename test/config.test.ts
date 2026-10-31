import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardConfig, FieldDef, StageConfig } from "#model/config";
import { validateScheduling } from "#model/placement";
import {
  DEFAULT_PROJECT_CONFIG,
  defaultBoard,
  resolveSettings,
  slug,
  uniqueId,
  validateBoard,
} from "../src/server/project/config.ts";
import { SfError } from "../src/server/project/errors.ts";
import { scheduling } from "./scheduling-fixture.ts";

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
    overrides: {
      worker: { model: "b-model" },
      worktree: { baseBranch: "develop" },
      claimTimeoutMinutes: 60,
      briefPreamble: "B",
    },
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

test("validateBoard checks Stage HIL fields", () => {
  const base = defaultBoard("Dev", "DEV");
  const schema: FieldDef[] = [
    { id: "hil", name: "HIL", type: "boolean" },
    { id: "note", name: "Note", type: "text" },
    { id: "count", name: "Count", type: "number" },
  ];
  const withHil = (stageId: string, hil: unknown) => ({
    ...base,
    schema,
    stages: base.stages.map((s) => (s.id === stageId ? { ...s, hil: hil as StageConfig["hil"] } : s)),
  });
  validateBoard(withHil("todo", { flag: "hil", comment: "note" }));
  validateBoard(withHil("todo", { flag: "hil" }));
  assert.throws(() => validateBoard(withHil("todo", { flag: "note" })), /must be a boolean field/);
  assert.throws(() => validateBoard(withHil("todo", { flag: "nope" })), /must be a boolean field/);
  assert.throws(() => validateBoard(withHil("todo", { flag: "hil", comment: "count" })), /must be a text field/);
  assert.throws(() => validateBoard(withHil("todo", { comment: "note" })), /needs a flag field/);
  assert.throws(() => validateBoard(withHil("backlog", { flag: "hil" })), /Backlog cannot have HIL fields/);
  assert.throws(() => validateBoard(withHil("done", { flag: "hil" })), /Done cannot have HIL fields/);
});

test("scheduling validates complete shapes and canonical mapping identities", () => {
  validateScheduling(scheduling());
  validateScheduling({ ...scheduling(), order: [] });
  const cases: unknown[] = [
    null,
    [],
    {},
    { ...scheduling(), local: null },
    { ...scheduling(), remotes: {} },
    { ...scheduling(), order: null },
    { ...scheduling(), order: ["missing"] },
    { ...scheduling(), order: ["local", "local"] },
    { ...scheduling(), extra: true },
  ];
  for (const capacity of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "2", null, undefined]) {
    cases.push({ ...scheduling(), local: { capacity } });
    const config = scheduling();
    config.remotes[0]!.capacity = capacity as number;
    cases.push(config);
  }
  for (const patch of [
    { id: "local" },
    { id: "b" },
    { id: "Bad" },
    { name: " " },
    { name: " a" },
    { environmentId: "env-b" },
    { environmentId: "https://host/id" },
    { environmentId: "/tmp/id" },
    { enabled: "true" },
    { project: null },
    { project: { projectId: "../path", repository: "github.com/o/r" } },
  ]) {
    const config = scheduling();
    Object.assign(config.remotes[0]!, patch);
    cases.push(config);
  }
  for (const repository of [
    "https://github.com/o/r",
    "git@github.com:o/r",
    "/tmp/repo",
    "./repo",
    "github.com/o//r",
    "github.com/o/../r",
    "github.com/o/r/",
    "github.com/o/r?q",
    "github.com/o/r#f",
    "github.com/o/ r",
    "github.com",
  ]) {
    const config = scheduling();
    config.remotes[0]!.project.repository = repository;
    cases.push(config);
  }
  const alias = scheduling();
  alias.remotes[0]!.enabled = false;
  alias.remotes[0]!.environmentId = "env-b";
  cases.push(alias);
  for (const config of cases)
    assert.throws(
      () => validateScheduling(config),
      (error: unknown) => error instanceof SfError && error.code === "invalid" && /scheduling/.test(error.message),
    );
  const board = defaultBoard("Dev", "DEV");
  assert.throws(() => validateBoard({ ...board, overrides: { scheduling: scheduling() } as never }), /Project-wide/);
  assert.throws(
    () => validateBoard({ ...board, stages: board.stages.map((s) => ({ ...s, scheduling: {} })) }),
    /per Stage/,
  );
  assert.throws(
    () => validateBoard({ ...board, schema: [{ id: "placement", name: "Old", type: "text" }] }),
    /reserved/,
  );
});
