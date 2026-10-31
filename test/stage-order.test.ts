import assert from "node:assert/strict";
import test from "node:test";
import { stageReorderIndex } from "../src/web/components/BoardSettings/stage-order.ts";

const stages = ["backlog", "todo", "in_progress", "review", "done"].map((id) => ({ id }));

test("Stage drops resolve before/after destinations in the full saved list", () => {
  assert.equal(stageReorderIndex(stages, "todo", "review"), 3);
  assert.equal(stageReorderIndex(stages, "review", "todo"), 1);
});

test("cancelled, no-op, stale, and fixed-boundary drops do not save", () => {
  for (const [active, over] of [
    ["todo", null],
    ["todo", "todo"],
    ["todo", "backlog"],
    ["todo", "done"],
    ["backlog", "todo"],
    ["done", "todo"],
    ["missing", "todo"],
    ["todo", "missing"],
  ])
    assert.equal(stageReorderIndex(stages, active!, over ?? null), null);
  assert.equal(stageReorderIndex([stages[0]!, stages[4]!], "backlog", "done"), null);
  assert.equal(stageReorderIndex([stages[0]!, stages[1]!, stages[4]!], "todo", "todo"), null);
});
