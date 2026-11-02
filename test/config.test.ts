import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardConfig, FieldDef, StageConfig } from "#model/config";
import { readMachines, validateRemoteMachines, validateScheduling } from "#model/placement";
import {
  DEFAULT_PROJECT_CONFIG,
  defaultBoard,
  resolveSettings,
  slug,
  uniqueId,
  validateBoard,
} from "../src/server/project/config.ts";
import { SfError } from "../src/server/project/errors.ts";
import { legacyScheduling, machines, remoteMachines, scheduling } from "./scheduling-fixture.ts";

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

test("scheduling validates complete shapes against the catalog it orders", () => {
  validateScheduling(scheduling(), remoteMachines());
  validateScheduling({ ...scheduling(), order: [] });
  validateScheduling({ local: { capacity: 0 }, order: ["local"] });
  const cases: unknown[] = [
    null,
    [],
    {},
    { ...scheduling(), local: null },
    { ...scheduling(), order: null },
    { ...scheduling(), order: ["missing"] },
    { ...scheduling(), order: ["local", "local"] },
    { ...scheduling(), extra: true },
    { ...scheduling(), remotes: [] },
  ];
  for (const capacity of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "2", null, undefined])
    cases.push({ ...scheduling(), local: { capacity } });
  for (const config of cases)
    assert.throws(
      () => validateScheduling(config, remoteMachines()),
      (error: unknown) => error instanceof SfError && error.code === "invalid" && /scheduling/.test(error.message),
    );
  assert.throws(() => validateScheduling(scheduling()), /unknown machine ID "a"; add it to remoteMachines/);
});

test("the remote machine catalog validates slugs, labels, enabled and optional capacity", () => {
  validateRemoteMachines(remoteMachines());
  validateRemoteMachines([]);
  validateRemoteMachines([{ id: "x", name: "X", enabled: false }]);
  validateRemoteMachines([{ id: "x", name: "X", enabled: true, capacity: 0 }]);
  const cases: unknown[] = [null, {}, [null]];
  for (const capacity of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "2", null])
    cases.push([{ id: "x", name: "X", enabled: true, capacity }]);
  for (const patch of [
    { id: "local" },
    { id: "b" },
    { id: "Bad" },
    { id: "1x" },
    { name: " " },
    { name: " a" },
    { name: undefined },
    { enabled: "true" },
    { environmentId: "env-a" },
    { project: { projectId: "p", repository: "github.com/o/r" } },
  ]) {
    const catalog = remoteMachines();
    Object.assign(catalog[0]!, patch);
    cases.push(catalog);
  }
  for (const catalog of cases)
    assert.throws(
      () => validateRemoteMachines(catalog),
      (error: unknown) => error instanceof SfError && error.code === "invalid" && /remoteMachines/.test(error.message),
    );
});

test("legacy scheduling.remotes is promoted to the catalog in memory; both catalogs conflict", () => {
  const legacy = legacyScheduling();
  legacy.remotes[1]!.enabled = false;
  assert.deepEqual(readMachines({ scheduling: legacy }), {
    remoteMachines: [
      { id: "a", name: "A", enabled: true, capacity: 4 },
      { id: "b", name: "B", enabled: false, capacity: 2 },
    ],
    scheduling: { local: { capacity: 2 }, order: ["a", "b", "local"] },
  });
  assert.deepEqual(readMachines({}), {});
  assert.deepEqual(readMachines(machines()), machines());
  assert.throws(
    () => readMachines({ remoteMachines: [], scheduling: legacyScheduling() }),
    /scheduling\.remotes: conflicts with remoteMachines; move each legacy remote/,
  );
  const bad = legacyScheduling();
  bad.remotes[0]!.capacity = -1;
  assert.throws(() => readMachines({ scheduling: bad }), /scheduling\.remotes\[0\]\.capacity/);
  assert.throws(() => readMachines({ scheduling: { ...legacyScheduling(), order: ["c"] } }), /unknown machine ID "c"/);
});

test("machines and scheduling are Project-wide", () => {
  const board = defaultBoard("Dev", "DEV");
  assert.throws(() => validateBoard({ ...board, overrides: { scheduling: scheduling() } as never }), /Project-wide/);
  assert.throws(
    () => validateBoard({ ...board, overrides: { remoteMachines: remoteMachines() } as never }),
    /remoteMachines is Project-wide/,
  );
  assert.throws(
    () => validateBoard({ ...board, stages: board.stages.map((s) => ({ ...s, scheduling: {} })) }),
    /per Stage/,
  );
  assert.throws(
    () => validateBoard({ ...board, schema: [{ id: "placement", name: "Old", type: "text" }] }),
    /reserved/,
  );
});
